import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ActionFeedbackProvider } from "@/components/ActionFeedback";

export const metadata: Metadata = {
  title: "Quality Ops Framework",
  description:
    "Interfaz del qa-kit: configura y ejecuta el ciclo QA (capas, trackers, BD, E2E) a clics, sin usar la CLI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ActionFeedbackProvider>
          <AppShell>{children}</AppShell>
        </ActionFeedbackProvider>
      </body>
    </html>
  );
}
