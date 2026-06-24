import type { Config } from "tailwindcss";

// Quality Ops Framework — tema oscuro + esmeralda + blanco.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0f0d", // fondo oscuro con leve tinte verde
        panel: "#111815",
        panel2: "#18211d",
        border: "#243029",
        accent: "#10b981", // esmeralda (acción principal)
        accent2: "#34d399", // esmeralda claro (hover/realce)
        danger: "#ef4444",
        warn: "#f59e0b",
        muted: "#8aa39a", // gris verdoso (texto secundario)
      },
    },
  },
  plugins: [],
};

export default config;
