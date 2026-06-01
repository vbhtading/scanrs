"use client";

import React, { useState } from "react";
import { X, Mail } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface SignInModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function SignInModal({ open, onClose, onSuccess }: SignInModalProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState<"google" | "email" | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  // Create Supabase client only in browser
  const supabase = typeof window !== "undefined" ? createClient() : null as any;

  async function signInWithGoogle() {
    setLoading("google");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      // redirect happens automatically
    } catch (e: any) {
      toast.error("Google sign-in failed", { description: e.message });
      setLoading(null);
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading("email");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;

      setEmailSent(true);
      toast.success("Magic link sent!", {
        description: `Check ${email} for your login link.`,
      });
    } catch (e: any) {
      toast.error("Failed to send link", { description: e.message });
    } finally {
      setLoading(null);
    }
  }

  function handleClose() {
    setEmail("");
    setEmailSent(false);
    setLoading(null);
    onClose();
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={handleClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0f1629] p-8 shadow-2xl"
        >
          <div className="flex justify-between items-start mb-6">
            <div>
              <div className="text-2xl font-semibold tracking-tight">Sign in to save watchlist</div>
              <div className="text-sm text-zinc-400 mt-1">Your selections sync across devices</div>
            </div>
            <button onClick={handleClose} className="text-zinc-400 hover:text-white p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          {emailSent ? (
            <div className="text-center py-8">
              <Mail className="w-12 h-12 mx-auto text-emerald-400 mb-4" />
              <div className="font-medium text-lg">Check your email</div>
              <p className="text-zinc-400 mt-2 text-sm">We sent a magic link to <span className="text-emerald-400">{email}</span></p>
              <button onClick={handleClose} className="mt-6 px-6 py-2 rounded-xl border border-white/10 hover:bg-white/5 text-sm">
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Google */}
              <button
                onClick={signInWithGoogle}
                disabled={!!loading}
                className="w-full flex items-center justify-center gap-3 h-12 rounded-2xl bg-white text-black font-semibold active:bg-zinc-100 disabled:opacity-60 mb-3 transition"
              >
                <span className="font-bold text-lg">G</span>
                {loading === "google" ? "Connecting..." : "Continue with Google"}
              </button>

              <div className="flex items-center gap-3 my-4">
                <div className="h-px flex-1 bg-white/10" />
                <div className="text-[10px] uppercase tracking-[2px] text-zinc-500">or</div>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {/* Email magic */}
              <form onSubmit={sendMagicLink} className="space-y-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full h-12 rounded-2xl border border-white/10 bg-black/30 px-4 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
                  required
                />
                <button
                  type="submit"
                  disabled={!!loading || !email.trim()}
                  className="w-full h-12 rounded-2xl border border-white/10 hover:bg-white/5 font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Mail className="w-4 h-4" />
                  {loading === "email" ? "Sending..." : "Send magic link"}
                </button>
              </form>

              <p className="text-[11px] text-center text-zinc-500 mt-6">
                We use secure magic links — no passwords needed.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
