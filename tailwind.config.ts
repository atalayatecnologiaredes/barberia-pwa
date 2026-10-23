import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brass: "#D4AF37",
        obsidian: "#0D0D0E",
        charcoal: "#1A1A1E",
        panel: "#202024",
        "panel-raised": "#29292E",
        line: "#38383E",
        electric: "#22C55E",
        muted: "#A1A1AA",
        danger: "#EF4444",
        warning: "#F59E0B",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui"] },
      boxShadow: { brass: "0 0 0 1px rgb(212 175 55 / .25), 0 8px 30px rgb(0 0 0 / .24)" },
      borderRadius: { xl: "1rem", "2xl": "1.25rem" },
      minHeight: { touch: "3rem" },
    },
  },
  plugins: [],
} satisfies Config;
