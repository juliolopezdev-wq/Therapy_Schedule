import { useState } from "react";
import { type SessionFormValue } from "@/components/board/SessionDialog";
import { type PatientFormValue } from "@/components/board/PatientDialog";
import { type WeekSessionRow } from "@/components/board/TargetReachedDialog";

export function useBoardUI() {
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState<SessionFormValue | null>(null);
  
  const [patientDialogOpen, setPatientDialogOpen] = useState(false);
  const [patientDraft, setPatientDraft] = useState<PatientFormValue | null>(null);
  
  const [panelOpen, setPanelOpen] = useState(false);
  const [staffPanelOpen, setStaffPanelOpen] = useState(false);
  const [weeklyMinutesPanelOpen, setWeeklyMinutesPanelOpen] = useState(false);
  const [askSchedulerPanelOpen, setAskSchedulerPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dataAnalysisOpen, setDataAnalysisOpen] = useState(false);
  
  const [targetAlertData, setTargetAlertData] = useState<{
    patientName: string;
    target: number;
    totalMinutes: number;
    weekSessions: WeekSessionRow[];
  } | null>(null);

  const [overrideWarning, setOverrideWarning] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

  return {
    sessionDialogOpen,
    setSessionDialogOpen,
    sessionDraft,
    setSessionDraft,
    patientDialogOpen,
    setPatientDialogOpen,
    patientDraft,
    setPatientDraft,
    panelOpen,
    setPanelOpen,
    staffPanelOpen,
    setStaffPanelOpen,
    weeklyMinutesPanelOpen,
    setWeeklyMinutesPanelOpen,
    askSchedulerPanelOpen,
    setAskSchedulerPanelOpen,
    historyOpen,
    setHistoryOpen,
    dataAnalysisOpen,
    setDataAnalysisOpen,
    targetAlertData,
    setTargetAlertData,
    overrideWarning,
    setOverrideWarning,
    collapsedSections,
    setCollapsedSections,
  };
}
