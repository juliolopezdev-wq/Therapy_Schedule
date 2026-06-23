import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, User } from "lucide-react";
import { useState } from "react";
import {
  THERAPY_META,
  TIME_SLOTS,
  formatLongDate,
  type TherapyType,
} from "@/lib/board";
import type { SessionTileData } from "./SessionTile";

interface MyScheduleProps {
  therapists: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  sessions: SessionTileData[];
  patients: { id: number; name: string; roomNumber: string }[];
  day: Date;
}

export function MySchedule({
  therapists,
  value,
  onChange,
  sessions,
  patients,
  day,
}: MyScheduleProps) {
  const [open, setOpen] = useState(false);

  const therapist = therapists.find((t) => t.id === value);

  const mySessions = useMemo(() => {
    if (!value) return [];
    return sessions
      .filter((s) => s.therapistId === value)
      .sort((a, b) => a.slotIndex - b.slotIndex);
  }, [sessions, value]);

  const patientName = (id: number) => {
    const p = patients.find((x) => x.id === id);
    return p ? `${p.name} · Rm ${p.roomNumber}` : "Unknown";
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 bg-white"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="mr-1 h-4 w-4" /> My Schedule
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>My Schedule</DialogTitle>
            <DialogDescription>{formatLongDate(day)}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Select
              value={value ? String(value) : "none"}
              onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select therapist" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select therapist…</SelectItem>
                {therapists.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!value ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <User className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">
                  Choose a therapist to view their personal day.
                </p>
              </div>
            ) : mySessions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <CalendarClock className="h-8 w-8 text-slate-300" />
                <p className="text-sm text-slate-500">
                  No sessions scheduled for {therapist?.name} today.
                </p>
              </div>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {mySessions.map((s) => {
                  const meta = THERAPY_META[s.therapyType as TherapyType];
                  const slot = TIME_SLOTS[s.slotIndex];
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                    >
                      <span
                        className="flex h-9 w-11 shrink-0 items-center justify-center rounded text-xs font-bold"
                        style={{ backgroundColor: meta.bg, color: meta.fg }}
                      >
                        {meta.label}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {patientName(s.patientId)}
                        </p>
                        <p className="text-xs text-slate-400">
                          {slot?.shortLabel} · {s.durationMinutes} min
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
