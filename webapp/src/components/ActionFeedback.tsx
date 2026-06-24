"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Spinner } from "@/components/ui";

/* ---------------------------------------------------------------------------
 * Feedback central de acciones.
 *
 * Cada acción de la webapp (guardar, añadir, eliminar, probar conexión,
 * detectar, ejecutar…) muestra una modal CENTRADA en la pantalla con el
 * estado de cargue y luego la confirmación correcta (o el error). No usa
 * toasts de la parte superior: siempre va al medio.
 *
 * Uso:
 *   const action = useAction();
 *   await action.run(
 *     { loading: "Guardando…", success: "Guardado" },
 *     async () => { ...trabajo...; if (mal) throw new Error("motivo"); }
 *   ).catch(() => {});   // el error ya se mostró en la modal
 *
 *   action.notify("Conexión añadida");        // confirmación directa (sin cargue)
 * ------------------------------------------------------------------------- */

type Phase = "loading" | "success" | "error";

type ModalState = {
  phase: Phase;
  loading: string;
  message: string; // texto de éxito o de error
};

type RunOpts = {
  /** Texto mientras la acción está en curso. */
  loading?: string;
  /** Texto al terminar bien (string o función del resultado). */
  success?: string | ((result: unknown) => string);
  /**
   * ms para autocerrar la modal de éxito (0 = no autocerrar, queda hasta que
   * el usuario cierre con «Entendido»). Si no se indica: 3000 ms para mensajes
   * cortos, y 0 (sin autocierre) para mensajes largos que cuesten leer a tiempo.
   */
  autoCloseMs?: number;
};

/** Sobre este largo, el mensaje no se autocierra: se lee con calma y se cierra a mano. */
const LONG_MESSAGE = 90;

/** ms de autocierre por defecto según el largo del mensaje (0 = no autocerrar). */
function defaultAutoClose(message: string): number {
  return message.length > LONG_MESSAGE ? 0 : 3000;
}

type ActionApi = {
  run: <T>(opts: RunOpts, fn: () => Promise<T> | T) => Promise<T>;
  /** Muestra una confirmación inmediata (acciones locales instantáneas). */
  notify: (message: string, phase?: "success" | "error") => void;
};

const Ctx = createContext<ActionApi | null>(null);

export function useAction(): ActionApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAction debe usarse dentro de <ActionFeedbackProvider>");
  return c;
}

/* ---------- ícono según fase ---------- */

function PhaseIcon({ phase }: { phase: Phase }) {
  if (phase === "loading") {
    return (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
        <span className="scale-150">
          <Spinner />
        </span>
      </span>
    );
  }
  if (phase === "success") {
    return (
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-green-400">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-red-400">
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </span>
  );
}

function FeedbackModal({ state, onClose }: { state: ModalState; onClose: () => void }) {
  // Esc cierra (no en cargue, para no interrumpir la operación a medias).
  useEffect(() => {
    if (state.phase === "loading") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.phase, onClose]);

  const title =
    state.phase === "loading"
      ? "Procesando…"
      : state.phase === "success"
      ? "¡Listo!"
      : "No se pudo completar";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={state.phase === "loading" ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-panel shadow-2xl p-6 text-center animate-[qof-pop_140ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-4">
          <PhaseIcon phase={state.phase} />
        </div>
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p
          className={`mt-1.5 text-sm whitespace-pre-line break-words ${
            state.phase === "error" ? "text-red-300" : "text-muted"
          }`}
        >
          {state.phase === "loading" ? state.loading : state.message}
        </p>
        {state.phase !== "loading" && (
          <button className="btn-primary mt-5 w-full justify-center" onClick={onClose}>
            Entendido
          </button>
        )}
      </div>
    </div>
  );
}

export function ActionFeedbackProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ModalState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const close = useCallback(() => {
    clearTimer();
    setState(null);
  }, []);

  const notify = useCallback((message: string, phase: "success" | "error" = "success") => {
    clearTimer();
    setState({ phase, loading: "", message });
    const ms = phase === "success" ? defaultAutoClose(message) : 0;
    if (ms > 0) timer.current = setTimeout(() => setState(null), ms);
  }, []);

  const run = useCallback(async <T,>(opts: RunOpts, fn: () => Promise<T> | T): Promise<T> => {
    clearTimer();
    setState({ phase: "loading", loading: opts.loading ?? "Procesando…", message: "" });
    try {
      const result = await fn();
      const message =
        typeof opts.success === "function"
          ? opts.success(result)
          : opts.success ?? "Operación completada";
      setState({ phase: "success", loading: "", message });
      const ms = opts.autoCloseMs ?? defaultAutoClose(message);
      if (ms > 0) timer.current = setTimeout(() => setState(null), ms);
      return result;
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : typeof e === "string" ? e : "Ocurrió un error inesperado";
      setState({ phase: "error", loading: "", message });
      throw e;
    }
  }, []);

  useEffect(() => () => clearTimer(), []);

  return (
    <Ctx.Provider value={{ run, notify }}>
      {children}
      {state && <FeedbackModal state={state} onClose={close} />}
    </Ctx.Provider>
  );
}
