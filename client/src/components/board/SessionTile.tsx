import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle } from "lucide-react";
import { THERAPY_META, type TherapyType } from "@/lib/board";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface SessionTileData {
  id: number;
  patientId: number;
  therapyType: TherapyType;
  therapistId: number | null;
  durationMinutes: number;
  slotIndex: number;
  slotSpan: number;
  notes?: string | null;
  hasConflict?: boolean;
}

interface SessionTileProps {
  session: SessionTileData;
  therapistName?: string;
  onClick?: (session: SessionTileData) => void;
  slotWidth: number;
  isOverlay?: boolean;
  onResize?: (id: number, newDurationMinutes: number) => void;
}

export function SessionTile({
  session,
  therapistName,
  onClick,
  slotWidth,
  isOverlay = false,
  onResize,
}: SessionTileProps) {
  const meta = THERAPY_META[session.therapyType];

  const [resizeDeltaSlots, setResizeDeltaSlots] = useState(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const initialSpan = session.slotSpan;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      let deltaSlots = Math.round(dx / slotWidth);
      if (initialSpan + deltaSlots < 1) deltaSlots = 1 - initialSpan;
      setResizeDeltaSlots(deltaSlots);
    };

    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);

      const dx = upEvent.clientX - startX;
      let finalDeltaSlots = Math.round(dx / slotWidth);
      if (initialSpan + finalDeltaSlots < 1) finalDeltaSlots = 1 - initialSpan;

      setResizeDeltaSlots(0);
      if (finalDeltaSlots !== 0 && onResize) {
        onResize(session.id, (initialSpan + finalDeltaSlots) * 30);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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

  const style: React.CSSProperties = {
    backgroundColor: meta.bg,
    color: meta.fg,
    width: isOverlay ? width : (resizeDeltaSlots !== 0 ? tileWidth : "100%"),
    transform: CSS.Translate.toString(transform),
    opacity: isDragging && !isOverlay ? 0.3 : 1,
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
      onClick={(e) => {
        e.stopPropagation();
        if (!isDragging) onClick?.(session);
      }}
      className={cn(
        "group relative flex h-full items-center justify-between gap-1 overflow-hidden rounded px-1.5 text-left border border-black/[0.05]",
        "cursor-grab touch-none select-none transition-all duration-150",
        "hover:shadow-sm hover:border-black/[0.10]",
        "active:cursor-grabbing",
        session.hasConflict && "ring-2 ring-red-500 animate-pulse-soft",
        isOverlay && "cursor-grabbing ring-2 ring-primary/80 shadow-lg",
      )}
    >
      {/* Left accent bar */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: meta.accent }}
      />

      <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: meta.fg }}>
              {meta.label}
            </span>
            {showFullInfo && (
              <span className="text-[9px] opacity-60 tabular-nums truncate" style={{ color: meta.fg }}>
                {session.durationMinutes}m
              </span>
            )}
          </div>
          {showFullInfo && therapistName ? (
            <span className="truncate text-[10px] font-medium opacity-75" style={{ color: meta.fg }}>
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
          className="absolute inset-y-0 right-0 w-3 cursor-ew-resize hover:bg-black/10 z-10"
          onPointerDown={handlePointerDown}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </button>
  );

  let tooltipText = session.notes || "";
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
