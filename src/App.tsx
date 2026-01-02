import React, { useState, useRef, useEffect, useCallback } from "react";
import { Download, Upload, Plus, Trash2, Eye, EyeOff, Crosshair, TrendingUp, CornerDownRight, Share2, Check, Undo, Redo, Copy, Clipboard, Lock, Maximize2 } from "lucide-react";

// --- Types ---
type TangentMode = "auto" | "linear" | "break" | "constant";

interface Point {
	id: string;
	x: number; // Time
	y: number; // Value
	leftTangent: { x: number; y: number };
	rightTangent: { x: number; y: number };
	mode: TangentMode;
}

interface Curve {
	id: string;
	name: string;
	color: string;
	points: Point[];
	isVisible: boolean;
}

interface ViewState {
	offsetX: number;
	offsetY: number;
	scaleX: number;
	scaleY: number;
}

interface SelectionItem {
	curveId: string;
	pointId: string;
}

// --- Constants ---
//const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const GRID_COLOR = "#333";
const TEXT_COLOR = "#888";
const CURVE_COLORS = ["#f97316", "#3b82f6", "#10b981", "#a855f7", "#ef4444", "#eab308"];

// --- Math Helpers ---
const solveCubicBezierX = (p0: number, p1: number, p2: number, p3: number, x: number): number => {
	let low = 0,
		high = 1;
	let t = 0.5;
	for (let i = 0; i < 15; i++) {
		t = (low + high) / 2;
		const cx = (1 - t) * (1 - t) * (1 - t) * p0 + 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t * p3;
		if (cx < x) low = t;
		else high = t;
	}
	return t;
};

const evalCubicBezierY = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
	return (1 - t) * (1 - t) * (1 - t) * p0 + 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t * p3;
};

const formatLabel = (val: number) => {
	const rounded = Math.round(val * 100000) / 100000;
	return rounded.toFixed(2).replace(/\.00$/, "");
};

// --- Compression Helpers ---
const MODES = ["auto", "linear", "break", "constant"];

const compressCurves = (curves: Curve[]) => {
	return curves.map((c) => [
		c.name,
		c.color,
		c.isVisible ? 1 : 0,
		c.points.map((p) => [
			Number(p.x.toFixed(4)),
			Number(p.y.toFixed(4)),
			Number(p.leftTangent.x.toFixed(4)),
			Number(p.leftTangent.y.toFixed(4)),
			Number(p.rightTangent.x.toFixed(4)),
			Number(p.rightTangent.y.toFixed(4)),
			MODES.indexOf(p.mode),
		]),
	]);
};

const decompressCurves = (data: any[]): Curve[] => {
	return data.map((c: any, i: number) => ({
		id: `curve-${Date.now()}-${i}`,
		name: c[0],
		color: c[1],
		isVisible: c[2] === 1,
		points: c[3].map((p: any) => ({
			id: Math.random().toString(36).substr(2, 9),
			x: p[0],
			y: p[1],
			leftTangent: { x: p[2], y: p[3] },
			rightTangent: { x: p[4], y: p[5] },
			mode: MODES[p[6]] as TangentMode,
		})),
	}));
};

const CurveEditor = () => {
	// --- State ---
	const [curves, setCurves] = useState<Curve[]>([
		{
			id: "curve-1",
			name: "Curve A",
			color: CURVE_COLORS[0],
			isVisible: true,
			points: [
				{ id: "1", x: 0, y: 0, leftTangent: { x: -0.2, y: 0 }, rightTangent: { x: 0.2, y: 0.5 }, mode: "auto" },
				{ id: "2", x: 1, y: 1, leftTangent: { x: -0.2, y: 0 }, rightTangent: { x: 0.2, y: 0 }, mode: "auto" },
			],
		},
	]);

	// Undo/Redo History
	const [history, setHistory] = useState<Curve[][]>([]);
	const [historyIndex, setHistoryIndex] = useState(-1);

	const [activeCurveId, setActiveCurveId] = useState<string>("curve-1");
	const [showPreview, setShowPreview] = useState(true);
	const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
	const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
	const [copied, setCopied] = useState(false);
	const [dataCopied, setDataCopied] = useState(false);

	const [view, setView] = useState<ViewState>({
		offsetX: 50,
		offsetY: CANVAS_HEIGHT / 2,
		scaleX: 200,
		scaleY: -200,
	});

	const [selection, setSelection] = useState<SelectionItem[]>([]);

	const [dragging, setDragging] = useState<{
		type: "point" | "handle-left" | "handle-right" | "pan" | "box-select";
		curveId?: string;
		pointId?: string;
		startX: number;
		startY: number;
		currentX?: number;
		currentY?: number;
		originalData?: any;
		hasMoved?: boolean;
	} | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// --- Initialization & History Management ---

	useEffect(() => {
		setHistory([curves]);
		setHistoryIndex(0);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const recordHistory = (newCurves: Curve[]) => {
		const newHistory = history.slice(0, historyIndex + 1);
		newHistory.push(newCurves);
		if (newHistory.length > 50) newHistory.shift();
		setHistory(newHistory);
		setHistoryIndex(newHistory.length - 1);
	};

	const modifyCurves = (newCurves: Curve[]) => {
		setCurves(newCurves);
		recordHistory(newCurves);
	};

	const handleUndo = useCallback(() => {
		if (historyIndex > 0) {
			const prevIndex = historyIndex - 1;
			setCurves(history[prevIndex]);
			setHistoryIndex(prevIndex);
			setSelection([]);
		}
	}, [history, historyIndex]);

	const handleRedo = useCallback(() => {
		if (historyIndex < history.length - 1) {
			const nextIndex = historyIndex + 1;
			setCurves(history[nextIndex]);
			setHistoryIndex(nextIndex);
			setSelection([]);
		}
	}, [history, historyIndex]);

	const fitViewToSelection = useCallback(() => {
		if (!containerRef.current) return;

		let pointsToFit: { x: number; y: number }[] = [];

		// If selection exists, fit to selection
		if (selection.length > 0) {
			selection.forEach((sel) => {
				const c = curves.find((crv) => crv.id === sel.curveId);
				const p = c?.points.find((pt) => pt.id === sel.pointId);
				if (p) pointsToFit.push({ x: p.x, y: p.y });
			});
		} else {
			// Else fit to all visible curves
			curves.forEach((c) => {
				if (c.isVisible) {
					c.points.forEach((p) => pointsToFit.push({ x: p.x, y: p.y }));
				}
			});
		}

		if (pointsToFit.length === 0) {
			// Reset to default if no points
			setView({
				offsetX: 50,
				offsetY: dimensions.height / 2,
				scaleX: 200,
				scaleY: -200,
			});
			return;
		}

		// Calculate bounds
		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity,
			maxY = -Infinity;
		pointsToFit.forEach((p) => {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		});

		// Add padding (e.g., 10% or 50px)
		const paddingX = 50;
		const paddingY = 50;
		const availableWidth = dimensions.width - paddingX * 2;
		const availableHeight = dimensions.height - paddingY * 2;

		const rangeX = Math.max(maxX - minX, 0.1); // Prevent div by zero
		const rangeY = Math.max(maxY - minY, 0.1);

		const newScaleX = availableWidth / rangeX;
		// Flip Y scale (negative)
		const newScaleY = -(availableHeight / rangeY);

		// Center the view
		// Center of bounds in graph units
		const midX = (minX + maxX) / 2;
		const midY = (minY + maxY) / 2;

		// Center of screen
		const screenMidX = dimensions.width / 2;
		const screenMidY = dimensions.height / 2;

		// offsetX = screenX - graphX * scaleX
		const newOffsetX = screenMidX - midX * newScaleX;
		const newOffsetY = screenMidY - midY * newScaleY;

		setView({
			scaleX: newScaleX,
			scaleY: newScaleY,
			offsetX: newOffsetX,
			offsetY: newOffsetY,
		});
	}, [selection, curves, dimensions]);

	// Keyboard Shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey) {
				if (e.key === "z") {
					e.preventDefault();
					if (e.shiftKey) handleRedo();
					else handleUndo();
				} else if (e.key === "y") {
					e.preventDefault();
					handleRedo();
				}
			}
			if (e.key === "Delete" || e.key === "Backspace") {
				deleteSelectedPoint();
			}
			if (e.key === "f" || e.key === "F") {
				fitViewToSelection();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleUndo, handleRedo, selection, curves, fitViewToSelection]);

	// --- URL State Management ---

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const data = params.get("data");
		if (data) {
			try {
				const jsonStr = atob(data);
				const parsed = JSON.parse(jsonStr);
				const loadedCurves = decompressCurves(parsed);
				if (loadedCurves.length > 0) {
					setCurves(loadedCurves);
					setHistory([loadedCurves]);
					setHistoryIndex(0);
					setActiveCurveId(loadedCurves[0].id);
				}
			} catch (e) {
				console.error("Failed to load from URL", e);
			}
		}
	}, []);

	useEffect(() => {
		if (window.location.protocol === "blob:") return;

		const timer = setTimeout(() => {
			try {
				const minified = compressCurves(curves);
				const jsonStr = JSON.stringify(minified);
				const base64 = btoa(jsonStr);
				const url = new URL(window.location.href);
				url.searchParams.set("data", base64);
				window.history.replaceState({}, "", url.toString());
			} catch (e) {
				if (e instanceof Error && e.name !== "SecurityError") {
					console.warn("Failed to save state to URL", e);
				}
			}
		}, 500);
		return () => clearTimeout(timer);
	}, [curves]);

	const handleCopyLink = () => {
		if (window.location.protocol === "blob:") {
			alert("Sharing via URL is not available in this preview environment.");
			return;
		}
		navigator.clipboard.writeText(window.location.href);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	// --- Event Listeners ---

	useEffect(() => {
		if (!containerRef.current) return;
		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setDimensions({
					width: entry.contentRect.width,
					height: entry.contentRect.height,
				});
			}
		});
		resizeObserver.observe(containerRef.current);
		return () => resizeObserver.disconnect();
	}, []);

	// --- Helpers: Coordinate Systems ---
	const toScreen = (x: number, y: number) => ({
		x: x * view.scaleX + view.offsetX,
		y: y * view.scaleY + view.offsetY,
	});

	const toGraph = (sx: number, sy: number) => ({
		x: (sx - view.offsetX) / view.scaleX,
		y: (sy - view.offsetY) / view.scaleY,
	});

	// --- Logic: Curve Calculation ---
	const generatePath = (points: Point[]) => {
		const sortedPoints = [...points].sort((a, b) => a.x - b.x);
		if (sortedPoints.length === 0) return "";

		const first = sortedPoints[0];
		const firstPos = toScreen(first.x, first.y);
		let path = `M ${firstPos.x} ${firstPos.y}`;

		for (let i = 0; i < sortedPoints.length - 1; i++) {
			const p0 = sortedPoints[i];
			const p1 = sortedPoints[i + 1];

			const p0Screen = toScreen(p0.x, p0.y);
			const p1Screen = toScreen(p1.x, p1.y);

			if (p0.mode === "constant") {
				path += ` L ${p1Screen.x} ${p0Screen.y} L ${p1Screen.x} ${p1Screen.y}`;
			} else if (p0.mode === "linear") {
				path += ` L ${p1Screen.x} ${p1Screen.y}`;
			} else {
				const cp0 = toScreen(p0.x + p0.rightTangent.x, p0.y + p0.rightTangent.y);
				const cp1 = toScreen(p1.x + p1.leftTangent.x, p1.y + p1.leftTangent.y);
				path += ` C ${cp0.x} ${cp0.y}, ${cp1.x} ${cp1.y}, ${p1Screen.x} ${p1Screen.y}`;
			}
		}
		return path;
	};

	const getCurveValueAtX = (curve: Curve, x: number): number | null => {
		const sorted = [...curve.points].sort((a, b) => a.x - b.x);
		if (sorted.length === 0) return null;
		if (x <= sorted[0].x) return sorted[0].y;
		if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

		const idx = sorted.findIndex((p) => p.x > x);
		if (idx === -1) return null;

		const pStart = sorted[idx - 1];
		const pEnd = sorted[idx];

		if (pStart.mode === "constant") return pStart.y;
		if (pStart.mode === "linear") {
			const t = (x - pStart.x) / (pEnd.x - pStart.x);
			return pStart.y + t * (pEnd.y - pStart.y);
		}

		const P0x = pStart.x;
		const P0y = pStart.y;
		const P1x = pStart.x + pStart.rightTangent.x;
		const P1y = pStart.y + pStart.rightTangent.y;
		const P2x = pEnd.x + pEnd.leftTangent.x;
		const P2y = pEnd.y + pEnd.leftTangent.y;
		const P3x = pEnd.x;
		const P3y = pEnd.y;

		const t = solveCubicBezierX(P0x, P1x, P2x, P3x, x);
		return evalCubicBezierY(P0y, P1y, P2y, P3y, t);
	};

	// --- Logic: Interaction ---
	const handleMouseDown = (e: React.MouseEvent, type: "point" | "handle-left" | "handle-right" | "bg", curveId?: string, pointId?: string) => {
		e.stopPropagation();
		e.preventDefault();

		if (e.button === 2 || (e.button === 0 && e.altKey)) {
			setDragging({ type: "pan", startX: e.clientX, startY: e.clientY, originalData: { ...view } });
			return;
		}

		if (type === "bg") {
			if (!e.shiftKey && !e.ctrlKey) {
				setSelection([]);
			}
			setDragging({
				type: "box-select",
				startX: e.clientX,
				startY: e.clientY,
				currentX: e.clientX,
				currentY: e.clientY,
			});
			return;
		}

		if (curveId && pointId) {
			setActiveCurveId(curveId);

			const isSelected = selection.some((s) => s.curveId === curveId && s.pointId === pointId);
			let newSelection = selection;

			if (type === "point") {
				if (e.shiftKey || e.ctrlKey) {
					if (isSelected) {
						newSelection = selection.filter((s) => !(s.curveId === curveId && s.pointId === pointId));
					} else {
						newSelection = [...selection, { curveId, pointId }];
					}
					setSelection(newSelection);
				} else {
					if (!isSelected) {
						newSelection = [{ curveId, pointId }];
						setSelection(newSelection);
					}
				}

				const dragTargets = isSelected && !e.shiftKey && !e.ctrlKey ? newSelection : isSelected ? newSelection : [{ curveId, pointId }];

				const originalData: any = {};
				dragTargets.forEach((sel) => {
					const c = curves.find((c) => c.id === sel.curveId);
					const p = c?.points.find((pt) => pt.id === sel.pointId);
					if (p) originalData[`${sel.curveId}:${sel.pointId}`] = { ...p };
				});

				setDragging({
					type: "point",
					curveId,
					pointId,
					startX: e.clientX,
					startY: e.clientY,
					originalData,
					hasMoved: false,
				});
			} else {
				if (!isSelected) {
					setSelection([{ curveId, pointId }]);
				}

				const c = curves.find((c) => c.id === curveId);
				const p = c?.points.find((pt) => pt.id === pointId);

				setDragging({
					type,
					curveId,
					pointId,
					startX: e.clientX,
					startY: e.clientY,
					originalData: p ? JSON.parse(JSON.stringify(p)) : null,
					hasMoved: false,
				});
			}
		}
	};

	const handleDoubleClick = (e: React.MouseEvent) => {
		if (!containerRef.current) return;
		if (!activeCurveId) return;

		const rect = containerRef.current.getBoundingClientRect();
		const graphPos = toGraph(e.clientX - rect.left, e.clientY - rect.top);

		const newPoint: Point = {
			id: Math.random().toString(36).substr(2, 9),
			x: graphPos.x,
			y: graphPos.y,
			leftTangent: { x: -0.1, y: 0 },
			rightTangent: { x: 0.1, y: 0 },
			mode: "auto",
		};

		const newCurves = curves.map((c) => {
			if (c.id === activeCurveId) {
				return { ...c, points: [...c.points, newPoint] };
			}
			return c;
		});

		modifyCurves(newCurves);
		setSelection([{ curveId: activeCurveId, pointId: newPoint.id }]);
	};

	const handleMouseMove = useCallback(
		(e: MouseEvent) => {
			if (!dragging) return;

			const rect = containerRef.current?.getBoundingClientRect();
			if (!rect) return;

			if (dragging.type === "pan") {
				const dx = e.clientX - dragging.startX;
				const dy = e.clientY - dragging.startY;
				setView({
					...view,
					offsetX: dragging.originalData.offsetX + dx,
					offsetY: dragging.originalData.offsetY + dy,
				});
				return;
			}

			if (dragging.type === "box-select") {
				setDragging((d) => (d ? { ...d, currentX: e.clientX, currentY: e.clientY } : null));
				return;
			}

			const pixelDx = e.clientX - dragging.startX;
			const pixelDy = e.clientY - dragging.startY;

			if (Math.abs(pixelDx) > 2 || Math.abs(pixelDy) > 2) {
				setDragging((d) => (d ? { ...d, hasMoved: true } : null));
			}

			const graphDx = pixelDx / view.scaleX;
			const graphDy = pixelDy / view.scaleY;

			setCurves((prevCurves) =>
				prevCurves.map((c) => {
					let pointsChanged = false;
					const updatedPoints = c.points.map((p) => {
						if (dragging.type === "point") {
							const key = `${c.id}:${p.id}`;
							const original = dragging.originalData[key];

							if (original) {
								pointsChanged = true;
								return {
									...p,
									x: original.x + graphDx,
									y: original.y + graphDy,
								};
							}
						} else if (c.id === dragging.curveId && p.id === dragging.pointId) {
							pointsChanged = true;
							if (dragging.type === "handle-right") {
								const newRT = {
									x: dragging.originalData.rightTangent.x + graphDx,
									y: dragging.originalData.rightTangent.y + graphDy,
								};
								let newLT = p.leftTangent;
								if (p.mode === "auto") {
									newLT = { x: -newRT.x, y: -newRT.y };
								}
								return { ...p, rightTangent: newRT, leftTangent: newLT };
							} else if (dragging.type === "handle-left") {
								const newLT = {
									x: dragging.originalData.leftTangent.x + graphDx,
									y: dragging.originalData.leftTangent.y + graphDy,
								};
								let newRT = p.rightTangent;
								if (p.mode === "auto") {
									newRT = { x: -newLT.x, y: -newLT.y };
								}
								return { ...p, leftTangent: newLT, rightTangent: newRT };
							}
						}
						return p;
					});

					return pointsChanged ? { ...c, points: updatedPoints } : c;
				})
			);
		},
		[dragging, view]
	);

	const handleMouseUp = useCallback(() => {
		if (dragging) {
			if (dragging.type === "box-select" && containerRef.current) {
				const rect = containerRef.current.getBoundingClientRect();
				const x1 = Math.min(dragging.startX, dragging.currentX || dragging.startX);
				const x2 = Math.max(dragging.startX, dragging.currentX || dragging.startX);
				const y1 = Math.min(dragging.startY, dragging.currentY || dragging.startY);
				const y2 = Math.max(dragging.startY, dragging.currentY || dragging.startY);

				const newSelection: SelectionItem[] = [];
				curves.forEach((c) => {
					if (!c.isVisible) return;
					c.points.forEach((p) => {
						const screen = toScreen(p.x, p.y);
						const screenClientX = screen.x + rect.left;
						const screenClientY = screen.y + rect.top;

						if (screenClientX >= x1 && screenClientX <= x2 && screenClientY >= y1 && screenClientY <= y2) {
							newSelection.push({ curveId: c.id, pointId: p.id });
						}
					});
				});
				setSelection(newSelection);
			} else if (dragging.hasMoved && dragging.type !== "pan") {
				recordHistory(curves);
			}
		}
		setDragging(null);
	}, [dragging, curves, view]);

	const handleSvgMouseMove = (e: React.MouseEvent) => {
		if (dragging || !showPreview) return;
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect) return;
		const graphPos = toGraph(e.clientX - rect.left, e.clientY - rect.top);
		setHoverPos({ x: graphPos.x, y: graphPos.y });
	};

	const handleSvgMouseLeave = () => {
		setHoverPos(null);
	};

	useEffect(() => {
		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [handleMouseMove, handleMouseUp]);

	const handleWheel = (e: React.WheelEvent) => {
		const zoomIntensity = 0.001;
		const zoomFactor = Math.exp(-e.deltaY * zoomIntensity);

		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect) return;

		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const graphMouseBefore = toGraph(mouseX, mouseY);

		// Independent Zoom Logic
		let zoomX = zoomFactor;
		let zoomY = zoomFactor;

		if (e.shiftKey) {
			zoomX = 1; // Lock X
			zoomY = zoomFactor; // Zoom Y
		} else if (e.altKey) {
			zoomX = zoomFactor; // Zoom X
			zoomY = 1; // Lock Y
		}

		const newScaleX = view.scaleX * zoomX;
		const newScaleY = view.scaleY * zoomY;

		const newOffsetX = mouseX - graphMouseBefore.x * newScaleX;
		const newOffsetY = mouseY - graphMouseBefore.y * newScaleY;

		setView({ scaleX: newScaleX, scaleY: newScaleY, offsetX: newOffsetX, offsetY: newOffsetY });
	};

	// --- CRUD Actions ---

	const addCurve = () => {
		const newId = `curve-${Date.now()}`;
		const colorIndex = curves.length % CURVE_COLORS.length;
		const newCurve: Curve = {
			id: newId,
			name: `Curve ${String.fromCharCode(65 + curves.length)}`, // A, B, C...
			color: CURVE_COLORS[colorIndex],
			isVisible: true,
			points: [],
		};

		const newCurves = [...curves, newCurve];
		modifyCurves(newCurves);
		setActiveCurveId(newId);
	};

	const deleteCurve = (id: string) => {
		if (curves.length <= 1) return;
		const newCurves = curves.filter((c) => c.id !== id);
		modifyCurves(newCurves);
		if (activeCurveId === id) {
			setActiveCurveId(newCurves[0].id);
			setSelection([]);
		}
	};

	const toggleVisibility = (id: string) => {
		const newCurves = curves.map((c) => (c.id === id ? { ...c, isVisible: !c.isVisible } : c));
		modifyCurves(newCurves);
	};

	const deleteSelectedPoint = () => {
		if (selection.length > 0) {
			const newCurves = curves.map((c) => {
				const hasSelection = selection.some((s) => s.curveId === c.id);
				if (!hasSelection) return c;

				return {
					...c,
					points: c.points.filter((p) => !selection.some((s) => s.curveId === c.id && s.pointId === p.id)),
				};
			});
			modifyCurves(newCurves);
			setSelection([]);
		}
	};

	const setTangentMode = (mode: TangentMode) => {
		if (selection.length === 0) return;

		const newCurves = curves.map((c) => {
			const hasSelection = selection.some((s) => s.curveId === c.id);
			if (!hasSelection) return c;

			return {
				...c,
				points: c.points.map((p) => {
					const isSelected = selection.some((s) => s.curveId === c.id && s.pointId === p.id);
					if (!isSelected) return p;

					let newP = { ...p, mode };

					// Force reset tangent if switching to a Bezier mode and tangent is too small or invalid
					if (mode === "auto" || mode === "break") {
						const minTangentLen = 0.1;
						if (Math.abs(newP.rightTangent.x) < minTangentLen) {
							newP.rightTangent = { x: 0.25, y: 0 };
						}
						if (Math.abs(newP.leftTangent.x) < minTangentLen) {
							newP.leftTangent = { x: -0.25, y: 0 };
						}
						if (mode === "auto") {
							newP.leftTangent = { x: -newP.rightTangent.x, y: -newP.rightTangent.y };
						}
					}

					return newP;
				}),
			};
		});
		modifyCurves(newCurves);
	};

	// --- Import / Export ---

	const loadCurvesFromJSON = (jsonString: string) => {
		try {
			const json = JSON.parse(jsonString);

			if (Array.isArray(json)) {
				const importedCurves: Curve[] = json.map((c: any, index: number) => ({
					id: `curve-${Date.now()}-${index}`,
					name: c.name || `Imported Curve ${index + 1}`,
					color: c.color || CURVE_COLORS[index % CURVE_COLORS.length],
					isVisible: true,
					points: c.points || [],
				}));

				if (importedCurves.length > 0) {
					modifyCurves(importedCurves);
					setActiveCurveId(importedCurves[0].id);
					setSelection([]);
				}
			} else {
				alert("Invalid JSON format: Expected an array of curves.");
			}
		} catch (err) {
			console.error("Failed to parse JSON", err);
			alert("Failed to parse JSON data.");
		}
	};

	const exportJSON = () => {
		const exportData = curves.map((c) => ({
			name: c.name,
			color: c.color,
			points: [...c.points].sort((a, b) => a.x - b.x),
		}));
		const data = JSON.stringify(exportData, null, 2);
		const blob = new Blob([data], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "curves_data.json";
		a.click();
	};

	const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (event) => {
			if (event.target?.result) {
				loadCurvesFromJSON(event.target.result as string);
			}
		};
		reader.readAsText(file);
		e.target.value = ""; // Reset input
	};

	const pasteDataFromClipboard = async () => {
		try {
			const text = await navigator.clipboard.readText();
			if (text) {
				loadCurvesFromJSON(text);
			}
		} catch (err) {
			// Fallback for environments where readText is restricted
			const text = prompt("Paste your curve JSON data here:");
			if (text) {
				loadCurvesFromJSON(text);
			}
		}
	};

	const triggerImport = () => {
		fileInputRef.current?.click();
	};

	const copyDataToClipboard = () => {
		const exportData = curves.map((c) => ({
			name: c.name,
			color: c.color,
			points: [...c.points].sort((a, b) => a.x - b.x),
		}));
		const data = JSON.stringify(exportData, null, 2);

		const textArea = document.createElement("textarea");
		textArea.value = data;
		textArea.style.position = "fixed";
		textArea.style.left = "-9999px";
		textArea.style.top = "0";
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();

		try {
			const successful = document.execCommand("copy");
			if (successful) {
				setDataCopied(true);
				setTimeout(() => setDataCopied(false), 2000);
			} else {
				console.error("Fallback: Copying text command was unsuccessful");
			}
		} catch (err) {
			console.error("Fallback: Oops, unable to copy", err);
		}

		document.body.removeChild(textArea);
	};

	// --- Components ---

	const Grid = () => {
		const lines = [];
		const { scaleX, scaleY, offsetX, offsetY } = view;

		const xStep = Math.pow(10, Math.floor(Math.log10(100 / Math.abs(scaleX))));
		const yStep = Math.pow(10, Math.floor(Math.log10(100 / Math.abs(scaleY))));

		const minX = -offsetX / scaleX;
		const maxX = (dimensions.width - offsetX) / scaleX;
		const minY = -offsetY / scaleY;
		const maxY = (dimensions.height - offsetY) / scaleY;

		const startI_X = Math.floor(minX / xStep);
		const endI_X = Math.ceil(maxX / xStep);

		for (let i = startI_X; i <= endI_X; i++) {
			const x = i * xStep;
			const xPos = x * scaleX + offsetX;
			if (xPos < -50 || xPos > dimensions.width + 50) continue;
			const isMain = Math.abs(i) % 10 === 0;
			lines.push(
				<g key={`v-${i}`}>
					<line x1={xPos} y1={0} x2={xPos} y2="100%" stroke={isMain ? "#555" : GRID_COLOR} strokeWidth={isMain ? 1.5 : 1} />
					<text x={xPos + 5} y={20} fill={TEXT_COLOR} fontSize="10" pointerEvents="none">
						{formatLabel(x)}
					</text>
				</g>
			);
		}

		const startI_Y = Math.floor(Math.min(minY, maxY) / yStep);
		const endI_Y = Math.ceil(Math.max(minY, maxY) / yStep);

		for (let i = startI_Y; i <= endI_Y; i++) {
			const y = i * yStep;
			const yPos = y * scaleY + offsetY;
			if (yPos < -50 || yPos > dimensions.height + 50) continue;
			const isMain = Math.abs(i) % 10 === 0;
			lines.push(
				<g key={`h-${i}`}>
					<line x1={0} y1={yPos} x2="100%" y2={yPos} stroke={isMain ? "#555" : GRID_COLOR} strokeWidth={isMain ? 1.5 : 1} />
					<text x={5} y={yPos - 5} fill={TEXT_COLOR} fontSize="10" pointerEvents="none">
						{formatLabel(y)}
					</text>
				</g>
			);
		}
		return <g>{lines}</g>;
	};

	const activeCurve = curves.find((c) => c.id === activeCurveId);
	const lastSelected = selection.length > 0 ? selection[selection.length - 1] : null;
	const selectedPointData = lastSelected ? curves.find((c) => c.id === lastSelected.curveId)?.points.find((p) => p.id === lastSelected.pointId) : null;

	return (
		<div className="flex flex-col h-screen w-full bg-neutral-900 text-neutral-200 font-sans overflow-hidden select-none">
			{/* Top Bar */}
			<div className="h-14 border-b border-neutral-800 bg-neutral-900 flex items-center px-4 justify-between z-10 shadow-md shrink-0">
				<div className="flex items-center space-x-4">
					<h1 className="font-bold text-orange-500 tracking-wider">
						CURVE<span className="text-white">ED</span>
					</h1>
					<div className="h-6 w-px bg-neutral-700 mx-2"></div>

					<div className="flex bg-neutral-800 rounded-md p-0.5 space-x-1">
						{/* Undo / Redo */}
						<button onClick={handleUndo} disabled={historyIndex <= 0} className={`p-1.5 rounded text-neutral-400 hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent`} title="Undo (Ctrl+Z)">
							<Undo size={14} />
						</button>
						<button onClick={handleRedo} disabled={historyIndex >= history.length - 1} className={`p-1.5 rounded text-neutral-400 hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent`} title="Redo (Ctrl+Y)">
							<Redo size={14} />
						</button>

						<div className="w-px h-4 bg-neutral-700 mx-1 self-center"></div>

						<button onClick={() => setTangentMode("auto")} className={`px-3 py-1 text-xs rounded-sm ${selectedPointData?.mode === "auto" ? "bg-neutral-600 text-white" : "hover:bg-neutral-700 text-neutral-400"}`}>
							Auto
						</button>
						<button onClick={() => setTangentMode("break")} className={`px-3 py-1 text-xs rounded-sm ${selectedPointData?.mode === "break" ? "bg-neutral-600 text-white" : "hover:bg-neutral-700 text-neutral-400"}`}>
							Break
						</button>
						<button
							onClick={() => setTangentMode("linear")}
							className={`px-3 py-1 text-xs rounded-sm flex items-center gap-1 ${selectedPointData?.mode === "linear" ? "bg-neutral-600 text-white" : "hover:bg-neutral-700 text-neutral-400"}`}
						>
							<TrendingUp size={12} /> Linear
						</button>
						<button
							onClick={() => setTangentMode("constant")}
							className={`px-3 py-1 text-xs rounded-sm flex items-center gap-1 ${selectedPointData?.mode === "constant" ? "bg-neutral-600 text-white" : "hover:bg-neutral-700 text-neutral-400"}`}
						>
							<CornerDownRight size={12} /> Step
						</button>
					</div>

					<button onClick={deleteSelectedPoint} disabled={selection.length === 0} className="p-1.5 text-neutral-400 hover:text-red-400 disabled:opacity-30 transition-colors">
						<Trash2 size={16} />
					</button>

					{/* Fit Button */}
					<button onClick={fitViewToSelection} className="p-1.5 text-neutral-400 hover:text-white transition-colors" title="Fit View (F)">
						<Maximize2 size={16} />
					</button>
				</div>

				<div className="flex items-center space-x-3 text-xs">
					{/* Toggle Preview Button */}
					<button
						onClick={() => setShowPreview(!showPreview)}
						className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${showPreview ? "bg-neutral-700 text-white border border-neutral-600" : "text-neutral-400 hover:bg-neutral-800"}`}
						title="Toggle Value Preview on Hover"
					>
						<Crosshair size={14} />
						<span>Preview</span>
					</button>

					{/* Hidden File Input */}
					<input type="file" ref={fileInputRef} onChange={importJSON} accept=".json" className="hidden" />

					<button onClick={triggerImport} className="flex items-center gap-2 bg-neutral-700 hover:bg-neutral-600 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors">
						<Upload size={14} /> Import
					</button>
					<button onClick={exportJSON} className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors">
						<Download size={14} /> Export
					</button>

					<button
						onClick={copyDataToClipboard}
						className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${dataCopied ? "bg-green-600 text-white" : "bg-neutral-700 hover:bg-neutral-600 text-white"}`}
					>
						{dataCopied ? <Check size={14} /> : <Copy size={14} />}
						{dataCopied ? "Copied!" : "Copy Data"}
					</button>

					<button
						onClick={pasteDataFromClipboard}
						className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors bg-neutral-700 hover:bg-neutral-600 text-white group relative"
						title="Requires clipboard permission"
					>
						<Clipboard size={14} />
						Paste
						<Lock size={10} className="text-neutral-400 opacity-60" />
					</button>

					<button onClick={handleCopyLink} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-semibold transition-colors ${copied ? "bg-green-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"}`}>
						{copied ? <Check size={14} /> : <Share2 size={14} />}
						{copied ? "Copied!" : "Share"}
					</button>
				</div>
			</div>

			<div className="flex flex-1 overflow-hidden">
				{/* Left Panel: Layers */}
				<div className="w-64 bg-[#1a1a1a] border-r border-neutral-800 flex flex-col shrink-0">
					<div className="p-3 border-b border-neutral-800 flex justify-between items-center">
						<span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Curves</span>
						<button onClick={addCurve} className="text-neutral-400 hover:text-white">
							<Plus size={16} />
						</button>
					</div>

					<div className="flex-1 overflow-y-auto">
						{curves.map((curve) => (
							<div
								key={curve.id}
								className={`group flex items-center gap-2 p-2 text-sm border-b border-neutral-800 cursor-pointer hover:bg-neutral-800 transition-colors ${
									activeCurveId === curve.id ? "bg-[#2a2a2a] border-l-2 border-l-orange-500" : "border-l-2 border-l-transparent"
								}`}
								onClick={() => setActiveCurveId(curve.id)}
							>
								<button
									className="text-neutral-500 hover:text-neutral-300 p-1"
									onClick={(e) => {
										e.stopPropagation();
										toggleVisibility(curve.id);
									}}
								>
									{curve.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
								</button>
								<div className="w-3 h-3 rounded-full" style={{ backgroundColor: curve.color }}></div>
								<input
									className="bg-transparent outline-none flex-1 w-full text-neutral-300"
									value={curve.name}
									onChange={(e) => {
										const newCurves = curves.map((c) => (c.id === curve.id ? { ...c, name: e.target.value } : c));
										modifyCurves(newCurves);
									}}
								/>
								<button
									className="opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-red-400 p-1"
									onClick={(e) => {
										e.stopPropagation();
										deleteCurve(curve.id);
									}}
								>
									<Trash2 size={12} />
								</button>
							</div>
						))}
					</div>
				</div>

				{/* Canvas Area */}
				<div className="flex-1 relative bg-[#1e1e1e] overflow-hidden" ref={containerRef} onContextMenu={(e) => e.preventDefault()}>
					<svg className="w-full h-full cursor-crosshair" onMouseDown={(e) => handleMouseDown(e, "bg")} onDoubleClick={handleDoubleClick} onWheel={handleWheel} onMouseMove={handleSvgMouseMove} onMouseLeave={handleSvgMouseLeave}>
						<Grid />

						{/* Render All Curves */}
						{curves
							.filter((c) => c.isVisible)
							.map((curve) => {
								const isActive = curve.id === activeCurveId;
								return (
									<g key={curve.id} opacity={isActive ? 1 : 0.6}>
										<path d={generatePath(curve.points)} fill="none" stroke={curve.color} strokeWidth={isActive ? 2 : 1.5} className="pointer-events-none" />
										{curve.points.map((p) => {
											const screenPos = toScreen(p.x, p.y);
											const isSelected = selection.some((s) => s.curveId === curve.id && s.pointId === p.id);
											const isBezier = p.mode === "auto" || p.mode === "break";
											return (
												<g key={p.id}>
													{isSelected && isBezier && (
														<g>
															<line
																x1={screenPos.x}
																y1={screenPos.y}
																x2={toScreen(p.x + p.leftTangent.x, p.y + p.leftTangent.y).x}
																y2={toScreen(p.x + p.leftTangent.x, p.y + p.leftTangent.y).y}
																stroke="#666"
																strokeDasharray="2,2"
															/>
															<line
																x1={screenPos.x}
																y1={screenPos.y}
																x2={toScreen(p.x + p.rightTangent.x, p.y + p.rightTangent.y).x}
																y2={toScreen(p.x + p.rightTangent.x, p.y + p.rightTangent.y).y}
																stroke="#666"
																strokeDasharray="2,2"
															/>
															<circle
																cx={toScreen(p.x + p.leftTangent.x, p.y + p.leftTangent.y).x}
																cy={toScreen(p.x + p.leftTangent.x, p.y + p.leftTangent.y).y}
																r="4"
																fill="#ddd"
																stroke="black"
																className="cursor-pointer hover:fill-white"
																onMouseDown={(e) => handleMouseDown(e, "handle-left", curve.id, p.id)}
															/>
															<circle
																cx={toScreen(p.x + p.rightTangent.x, p.y + p.rightTangent.y).x}
																cy={toScreen(p.x + p.rightTangent.x, p.y + p.rightTangent.y).y}
																r="4"
																fill="#ddd"
																stroke="black"
																className="cursor-pointer hover:fill-white"
																onMouseDown={(e) => handleMouseDown(e, "handle-right", curve.id, p.id)}
															/>
														</g>
													)}
													<g transform={`translate(${screenPos.x}, ${screenPos.y})`}>
														<rect
															x="-6"
															y="-6"
															width="12"
															height="12"
															transform="rotate(45)"
															fill={isSelected ? "#fff" : "#1a1a1a"}
															stroke={isSelected ? curve.color : "#666"}
															strokeWidth="2"
															className="cursor-pointer transition-colors"
															onMouseDown={(e) => handleMouseDown(e, "point", curve.id, p.id)}
														/>
													</g>
												</g>
											);
										})}
									</g>
								);
							})}

						{/* Box Selection Rect */}
						{dragging && dragging.type === "box-select" && (
							<rect
								x={Math.min(dragging.startX, dragging.currentX || dragging.startX) - (containerRef.current?.getBoundingClientRect().left || 0)}
								y={Math.min(dragging.startY, dragging.currentY || dragging.startY) - (containerRef.current?.getBoundingClientRect().top || 0)}
								width={Math.abs((dragging.currentX || dragging.startX) - dragging.startX)}
								height={Math.abs((dragging.currentY || dragging.startY) - dragging.startY)}
								fill="rgba(249, 115, 22, 0.1)"
								stroke="#f97316"
								strokeWidth="1"
								pointerEvents="none"
							/>
						)}

						{/* Preview Overlay */}
						{showPreview && hoverPos && !dragging && (
							<g pointerEvents="none">
								{/* Vertical Time Line */}
								<line x1={toScreen(hoverPos.x, 0).x} y1={0} x2={toScreen(hoverPos.x, 0).x} y2="100%" stroke="#888" strokeOpacity={0.5} strokeDasharray="4,4" strokeWidth="1" />

								{/* Time Label at Bottom */}
								<g transform={`translate(${toScreen(hoverPos.x, 0).x}, ${dimensions.height - 20})`}>
									<rect x="-24" y="-10" width="48" height="20" rx="4" fill="#fbbf24" stroke="none" />
									<text x="0" y="4" fill="#111" fontSize="11" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
										{hoverPos.x.toFixed(2)}
									</text>
								</g>

								{/* Curve Intersections with Tooltips */}
								{curves
									.filter((c) => c.isVisible)
									.map((curve) => {
										const val = getCurveValueAtX(curve, hoverPos.x);
										if (val === null) return null;
										const screenPos = toScreen(hoverPos.x, val);

										// Determine label position (avoid clipping on right edge)
										const isRightSide = screenPos.x > dimensions.width - 100;
										const labelX = isRightSide ? screenPos.x - 45 : screenPos.x + 10;

										return (
											<g key={`preview-${curve.id}`}>
												{/* Horizontal Intersection Line */}
												<line x1={0} y1={screenPos.y} x2="100%" y2={screenPos.y} stroke={curve.color} strokeOpacity={0.3} strokeDasharray="4,4" strokeWidth="1" />

												{/* Intersection Dot */}
												<circle cx={screenPos.x} cy={screenPos.y} r={4} fill={curve.color} stroke="#1e1e1e" strokeWidth={1} />

												{/* Tooltip Tag */}
												<g transform={`translate(${labelX}, ${screenPos.y - 10})`}>
													<rect width="40" height="20" rx="3" fill="#111" stroke={curve.color} strokeWidth="1" />
													<text
														x="20"
														y="10"
														fill="#fbbf24" // Yellowish text
														fontSize="11"
														fontWeight="bold"
														fontFamily="monospace"
														textAnchor="middle"
														dominantBaseline="middle"
													>
														{val.toFixed(1)}
													</text>
												</g>
											</g>
										);
									})}
							</g>
						)}
					</svg>

					<div className="absolute bottom-4 left-4 pointer-events-none bg-black/50 p-2 rounded text-xs text-neutral-400 font-mono z-20">
						<div>Zoom: {view.scaleX.toFixed(1)}%</div>
						<div>
							Active: <span style={{ color: activeCurve?.color }}>{activeCurve?.name}</span>
						</div>
					</div>

					{selectedPointData && (
						<div className="absolute top-8 left-12 bg-[#252525] border border-neutral-800 p-2 flex gap-3 text-xs items-center justify-center z-20 rounded shadow-lg">
							<div className="flex items-center gap-2">
								<span className="text-neutral-500 font-bold">T</span>
								<input
									type="number"
									step="0.01"
									className="bg-[#111] border border-neutral-700 rounded px-1.5 py-1 w-16 text-white focus:border-orange-500 outline-none text-right font-mono"
									value={selectedPointData.x}
									onChange={(e) => {
										const val = parseFloat(e.target.value);
										if (!isNaN(val) && selection.length > 0) {
											const newCurves = curves.map((c) => {
												const hasSelection = selection.some((s) => s.curveId === c.id);
												if (!hasSelection) return c;
												return { ...c, points: c.points.map((p) => (selection.some((s) => s.curveId === c.id && s.pointId === p.id) ? { ...p, x: val } : p)) };
											});
											modifyCurves(newCurves);
										}
									}}
								/>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-neutral-500 font-bold">V</span>
								<input
									type="number"
									step="0.01"
									className="bg-[#111] border border-neutral-700 rounded px-1.5 py-1 w-16 text-white focus:border-orange-500 outline-none text-right font-mono"
									value={selectedPointData.y}
									onChange={(e) => {
										const val = parseFloat(e.target.value);
										if (!isNaN(val) && selection.length > 0) {
											const newCurves = curves.map((c) => {
												const hasSelection = selection.some((s) => s.curveId === c.id);
												if (!hasSelection) return c;
												return { ...c, points: c.points.map((p) => (selection.some((s) => s.curveId === c.id && s.pointId === p.id) ? { ...p, y: val } : p)) };
											});
											modifyCurves(newCurves);
										}
									}}
								/>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default CurveEditor;
