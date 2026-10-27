import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertCircle, ArrowRight, Loader2, Lock, Mail, MailCheck, Timer, UserCheck } from "lucide-react";
import { useState } from "react";
import { Redirect, useSearch } from "wouter";

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "That sign-in link is missing its token. Request a fresh one below.",
  invalid_or_expired: "That sign-in link has expired or was already used. Request a fresh one below.",
  server_error: "We couldn't verify that link. Please try again.",
};

/**
 * Weekly-minutes snapshot: a progress ring for the unit plus a few patient bars racing toward
 * their weekly therapy-minute target -- what MinuteMinder is literally for.
 */
function MinutesIllustration() {
  const R = 34;
  const C = 2 * Math.PI * R;
  const pct = 0.82;
  const patients = [
    { label: "Rm 204", mins: 300, color: "#34d399" },
    { label: "Rm 211", mins: 245, color: "#38bdf8" },
    { label: "Rm 218", mins: 160, color: "#fbbf24" },
  ];
  const TARGET = 300;
  const BAR_X = 152;
  const BAR_W = 150;
  return (
    <svg viewBox="0 0 320 120" className="h-auto w-full" aria-hidden>
      {/* Unit progress ring */}
      <g transform="translate(58 60)">
        <circle r={R} fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="9" />
        <circle
          r={R}
          fill="none"
          stroke="url(#mm-ring)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`}
          transform="rotate(-90)"
        />
        {/* minute ticks */}
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={i} x1="0" y1={-R - 10} x2="0" y2={-R - 13} stroke="#94a3b8" strokeOpacity="0.35" strokeWidth="1.5" transform={`rotate(${i * 30})`} />
        ))}
        <text y="2" textAnchor="middle" fill="#ffffff" fontSize="17" fontWeight="800">82%</text>
        <text y="15" textAnchor="middle" fill="#94a3b8" fontSize="7.5" fontWeight="600" letterSpacing="0.8">ON TRACK</text>
      </g>

      {/* Patient minute bars */}
      {patients.map((p, i) => {
        const y = 22 + i * 32;
        return (
          <g key={p.label}>
            <text x={BAR_X} y={y - 4} fill="#94a3b8" fontSize="8.5" fontWeight="600">{p.label}</text>
            <text x={BAR_X + BAR_W} y={y - 4} textAnchor="end" fill="#cbd5e1" fontSize="8.5" fontWeight="700">{p.mins} min</text>
            <rect x={BAR_X} y={y} width={BAR_W} height="7" rx="3.5" fill="#ffffff" fillOpacity="0.07" />
            <rect x={BAR_X} y={y} width={(BAR_W * p.mins) / TARGET} height="7" rx="3.5" fill={p.color} fillOpacity="0.85" />
          </g>
        );
      })}
      {/* weekly target marker */}
      <line x1={BAR_X + BAR_W} y1="12" x2={BAR_X + BAR_W} y2="94" stroke="#e2e8f0" strokeOpacity="0.35" strokeDasharray="2 3" />
      <text x={BAR_X + BAR_W} y="108" textAnchor="end" fill="#64748b" fontSize="7.5" fontWeight="600" letterSpacing="0.6">WEEKLY TARGET</text>

      <defs>
        <linearGradient id="mm-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#34d399" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function Login() {
  const search = useSearch();
  const errorCode = new URLSearchParams(search).get("error");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const currentUser = trpc.auth.me.useQuery(undefined, { retry: false });

  const requestLink = trpc.auth.requestLink.useMutation({
    onSuccess: () => setSent(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    requestLink.mutate({ email: email.trim() });
  };

  if (currentUser.data) return <Redirect to="/board" />;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
      {/* One soft, static glow -- keeps the page calm */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[48rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-blue-600/15 blur-3xl" />

      <div className="relative w-full max-w-md animate-in fade-in slide-in-from-bottom-2 duration-500">
        {/* Brand */}
        <div className="mb-9 flex flex-col items-center text-center">
          <div className="relative mb-5">
            <div aria-hidden className="absolute inset-0 -m-3 rounded-[1.75rem] bg-gradient-to-br from-sky-400/30 to-emerald-400/20 blur-xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 via-blue-500 to-blue-700 shadow-lg shadow-blue-900/50 ring-1 ring-white/20">
              <div aria-hidden className="absolute inset-x-0 top-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-white/25 to-transparent" />
              <BrandLogo className="relative h-8 w-8 text-white" />
            </div>
          </div>
          <p className="text-[34px] font-black leading-none tracking-tight">
            <span className="text-white">Minute</span>
            <span className="bg-gradient-to-r from-sky-300 to-emerald-300 bg-clip-text text-transparent">Minder</span>
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span aria-hidden className="h-px w-8 bg-gradient-to-r from-transparent to-slate-600" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Every minute, on track</p>
            <span aria-hidden className="h-px w-8 bg-gradient-to-l from-transparent to-slate-600" />
          </div>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/50">
          {/* Illustration header */}
          <div className="border-b border-white/5 bg-gradient-to-b from-slate-800/60 to-slate-900 px-6 pt-6 pb-4">
            <MinutesIllustration />
          </div>

          <div className="p-7">
            {sent ? (
              <div className="text-center animate-in fade-in duration-300">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 ring-1 ring-emerald-300/30">
                  <MailCheck className="h-6 w-6 text-emerald-300" />
                </div>
                <h1 className="text-xl font-bold text-white">Your link is on its way</h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  If <span className="font-medium text-slate-200">{email}</span> has access, you'll get an
                  email in a moment. Tap the link inside and you're straight back to the minutes.
                </p>
                <p className="mt-3 text-xs text-slate-500">Not seeing it? Check your spam folder.</p>
                <button
                  id="login-use-different-email"
                  type="button"
                  onClick={() => setSent(false)}
                  className="mt-5 text-sm font-medium text-sky-300 hover:text-sky-200"
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-bold text-white">Let's mind those minutes.</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Enter your work email and we'll send you a link to today's minutes.
                </p>

                {errorCode && (
                  <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{ERROR_MESSAGES[errorCode] ?? "Sign-in didn't work. Please try again."}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
                  <label htmlFor="login-email" className="sr-only">Work email</label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="name@hospital.org"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                      required
                      className="h-11 rounded-lg border-white/10 bg-slate-950 pl-10 text-white placeholder:text-slate-600 focus-visible:border-sky-400/70 focus-visible:ring-sky-400/20"
                    />
                  </div>
                  <Button
                    id="login-submit"
                    type="submit"
                    disabled={requestLink.isPending}
                    className="group h-11 rounded-lg bg-sky-500 font-semibold text-slate-950 transition-colors hover:bg-sky-400"
                  >
                    {requestLink.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...
                      </>
                    ) : (
                      <>
                        Email me a sign-in link
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </Button>
                  {requestLink.error && (
                    <p className="text-center text-sm text-red-300">{requestLink.error.message}</p>
                  )}
                </form>

                {/* Trust badges */}
                <ul className="mt-6 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                  <li className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.03] py-2.5">
                    <Lock className="h-3.5 w-3.5 text-sky-300/80" />
                    No password
                  </li>
                  <li className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.03] py-2.5">
                    <Timer className="h-3.5 w-3.5 text-sky-300/80" />
                    Link lasts 15 min
                  </li>
                  <li className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.03] py-2.5">
                    <UserCheck className="h-3.5 w-3.5 text-sky-300/80" />
                    Invite-only
                  </li>
                </ul>
              </>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Need access? Ask your therapy manager to send you an invite.
        </p>
      </div>
    </main>
  );
}
