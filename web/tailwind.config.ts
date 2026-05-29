import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        "a-blue":         "#0066cc",
        "a-blue-hover":   "#0071e3",
        "a-blue-sky":     "#2997ff",
        "a-ink":          "#1d1d1f",
        "a-ink-secondary":"#333333",
        "a-ink-muted":    "#7a7a7a",
        "a-canvas":       "#ffffff",
        "a-parchment":    "#f5f5f7",
        "a-pearl":        "#fafafc",
        "a-tile":         "#272729",
        "a-hairline":     "#e0e0e0",
        "a-divider":      "#f0f0f0",
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', "Pretendard", "system-ui", "-apple-system", "BlinkMacSystemFont", '"Helvetica Neue"', "Arial", "sans-serif"],
        display: ['"Pretendard Variable"', "Pretendard", "system-ui", "-apple-system", "BlinkMacSystemFont", '"Helvetica Neue"', "Arial", "sans-serif"],
        numeric: ['"Pretendard Variable"', "Pretendard", "system-ui", "-apple-system", "sans-serif"],
      },
      keyframes: {
        "toast-in": {
          "0%":   { opacity: "0", transform: "translateY(6px) scale(0.97)" },
          "100%": { opacity: "1", transform: "translateY(0)   scale(1)"    },
        },
      },
      animation: {
        "toast-in": "toast-in 0.18s ease-out forwards",
      },
    },
  },
  plugins: [],
};
export default config;
