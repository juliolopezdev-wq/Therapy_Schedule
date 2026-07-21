import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, Lock, CheckCircle2, XCircle, Users } from "lucide-react";
import { THERAPY_META, isMissedStatus, type TherapyType, type SessionStatus, type DeliveryMode } from "@/lib/board";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface SessionTileData {
  id: number;
  patientId: number;
  therapyType: TherapyType;
  therapistId: number | null;
  durationMinutes: number;
  actualDurationMinutes?: number | null;
  slotIndex: number;
  slotSpan: number;
  status: SessionStatus;
  deliveryMode?: DeliveryMode;
  missedReason?: string | null;
  notes?: string | null;
  hasConflict?: boolean;
}

interface SessionTileProps {
  session: SessionTileData;
  therapistName?: string;
  therapistColor?: string;
  onClick?: (session: SessionTileData) => void;
  slotWidth: number;
  isOverlay?: boolean;
  onResize?: (id: number, newDurationMinutes: number) => void;
}

export function SessionTile({
  session,
  therapistName,
  therapistColor,
  onClick,
  slotWidth,
  isOverlay = false,
  onResize,
}: SessionTileProps) {
  const meta = THERAPY_META[session.therapyType];

  const [resizeDeltaSlots, setResizeDeltaSlots] = useState(0);

  const handleResizeStart = (startX: number) => {
    const initialSpan = session.slotSpan;

    const onMove = (clientX: number) => {
      const dx = clientX - startX;
      let deltaSlots = Math.round(dx / slotWidth);
      if (initialSpan + deltaSlots < 1) deltaSlots = 1 - initialSpan;
      setResizeDeltaSlots(deltaSlots);
    };

    const onUp = (clientX: number) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);

      const dx = clientX - startX;
      let finalDeltaSlots = Math.round(dx / slotWidth);
      if (initialSpan + finalDeltaSlots < 1) finalDeltaSlots = 1 - initialSpan;

      setResizeDeltaSlots(0);
      if (finalDeltaSlots !== 0 && onResize) {
        onResize(session.id, (initialSpan + finalDeltaSlots) * 30);
      }
    };

    const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const onMouseUp = (e: MouseEvent) => onUp(e.clientX);
    const onTouchMove = (e: TouchEvent) => onMove(e.touches[0].clientX);
    const onTouchEnd = (e: TouchEvent) => onUp(e.changedTouches[0].clientX);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
  };

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `session-${session.id}`,
    data: { session },
    disabled: isOverlay,
  });

  const width = session.slotSpan * slotWidth - 6;

  // First up to 2 initials of each therapist name word, e.g. "Aaron Smith" -> "AS"
  const initials = therapistName
    ? therapistName
        .split(" ")
        .filter((w) => /^[A-Za-z]/.test(w))
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("")
    : "";

  const visualSpan = session.slotSpan + resizeDeltaSlots;
  const showFullInfo = visualSpan >= 2;
  const tileWidth = visualSpan * slotWidth - 6;
  const isMissed = isMissedStatus(session.status);
  // Completed sessions get grayed out (on top of the green checkmark below) so a glance at
  // the board shows what's still outstanding vs. already delivered.
  const isCompleted = session.status === "completed";
  
  let bgColor = isCompleted ? "#e2e8f0" : meta.bg; // slate-200
  let textColor = isCompleted ? "#64748b" : meta.fg; // slate-500
  let accentColor = isCompleted ? "#94a3b8" : meta.accent; // slate-400

  if (!isCompleted && therapistColor && !isNaN(Number(therapistColor))) {
    const hue = Number(therapistColor);
    bgColor = `hsl(${hue}, 80%, 85%)`;
    textColor = `hsl(${hue}, 80%, 25%)`;
    accentColor = `hsl(${hue}, 80%, 45%)`;
  }

  const style: React.CSSProperties = {
    backgroundColor: bgColor,
    color: textColor,
    width: isOverlay ? width : (resizeDeltaSlots !== 0 ? tileWidth : "100%"),
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isOverlay ? 0.3 : (isMissed ? 0.6 : isCompleted ? 0.75 : 1),
    boxShadow: isOverlay
      ? "0 12px 28px -4px rgba(15,23,42,0.3)"
      : "0 1px 3px 0 rgba(0, 0, 0, 0.05), inset 0 1px 0 0 rgba(255, 255, 255, 0.4)",
    zIndex: resizeDeltaSlots !== 0 ? 50 : undefined,
  };

  const tileContent = (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onClick?.(session);
      }}
      className={cn(
        "group relative flex h-full items-center justify-between gap-1 overflow-hidden rounded px-1.5 text-left",
        session.therapyType === "Block" ? "border-2 border-dashed border-slate-400/50 bg-[repeating-linear-gradient(-45deg,rgba(0,0,0,0.05),rgba(0,0,0,0.05)_6px,transparent_6px,transparent_12px)]" : "border border-black/[0.05]",
        "cursor-grab touch-none select-none",
        // Only ease hover/status color changes -- never the drag transform or the live resize
        // width. Both update on every pointer-move tick during an active drag/resize, so easing
        // them makes the tile visibly lag a beat behind the cursor instead of tracking it 1:1.
        isDragging || resizeDeltaSlots !== 0 ? "transition-colors duration-150" : "transition-all duration-300",
        "hover:shadow-md hover:border-black/[0.15] hover:-translate-y-[1px] hover:scale-[1.02]",
        "active:cursor-grabbing",
        session.hasConflict && "ring-2 ring-red-500 animate-pulse-soft",
        isOverlay && "cursor-grabbing ring-2 ring-primary/80 shadow-lg",
      )}
    >
      {/* Left accent bar */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: accentColor }}
      />

      {/* Completed/missed badge -- deliberately larger/higher-contrast than the other inline
          status icons so "delivered" vs. "missed" reads at a glance even once the tile is
          grayed/dimmed out. Statuses are mutually exclusive, so these never both render. */}
      {isCompleted && (
        <span
          aria-hidden
          className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-green-600/20"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" strokeWidth={2.5} fill="white" />
        </span>
      )}
      {isMissed && (
        <span
          aria-hidden
          className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-red-600/20"
        >
          <XCircle className="h-3.5 w-3.5 text-red-600" strokeWidth={2.5} fill="white" />
        </span>
      )}

      <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <div className="flex items-center gap-1">
            {session.therapyType === "Block" && <Lock className="h-2.5 w-2.5" style={{ color: textColor }} strokeWidth={3} />}
            {(session.deliveryMode === "group" || session.deliveryMode === "concurrent") && (
              <Users className="h-2.5 w-2.5" style={{ color: textColor }} strokeWidth={2.5} />
            )}
            {isMissed && <XCircle className="h-2.5 w-2.5" style={{ color: textColor }} strokeWidth={2.5} />}
            <span className={cn("text-[10px] font-bold uppercase tracking-wide", isMissed && "line-through")} style={{ color: textColor }}>
              {session.therapyType === "Block" ? "Blocked" : meta.label}
            </span>
            {showFullInfo && (
              <span className={cn("text-[9px] opacity-60 tabular-nums truncate", isMissed && "line-through")} style={{ color: textColor }}>
                {session.durationMinutes}m
              </span>
            )}
          </div>
          {showFullInfo && therapistName ? (
            <span className="truncate text-[9px] font-medium opacity-75" style={{ color: textColor }}>
              {therapistName}
            </span>
          ) : null}
        </div>
      </div>

      {/* Right: initials or conflict warning */}
      <div className="flex shrink-0 items-center pl-1">
        {!showFullInfo && initials && !session.hasConflict ? (
          <span
            className="flex h-4 min-w-[16px] px-[3px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white shadow-sm"
            style={{ backgroundColor: meta.accent }}
          >
            {initials}
          </span>
        ) : null}

        {session.hasConflict ? (
          <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" strokeWidth={2.5} />
        ) : null}
      </div>

      {/* Right resize handle */}
      {!isOverlay && onResize && (
        <div
          className="absolute inset-y-0 right-0 w-3 cursor-ew-resize hover:bg-black/10 z-10 touch-none"
          onMouseDown={(e) => {
            e.stopPropagation();
            handleResizeStart(e.clientX);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            handleResizeStart(e.touches[0].clientX);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </button>
  );

  let tooltipText = session.notes || "";
  if (isMissed) {
    const missedMsg = session.missedReason ? `Missed: ${session.missedReason}` : "Missed";
    tooltipText = tooltipText ? `${missedMsg}\n\nNotes: ${tooltipText}` : missedMsg;
  }
  if (session.hasConflict) {
    const conflictMsg = "⚠️ Scheduling Conflict: Overlapping sessions detected for this patient or therapist.";
    tooltipText = tooltipText ? `${conflictMsg}\n\nNotes: ${tooltipText}` : conflictMsg;
  }

  if (tooltipText && !isDragging && !isOverlay) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="h-full w-full">{tileContent}</div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px] text-xs whitespace-pre-wrap">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    );
  }

  return tileContent;
}
