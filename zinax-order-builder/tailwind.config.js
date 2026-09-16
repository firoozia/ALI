/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
          600: "#475569",
          500: "#64748b",
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
          50: "#f8fafc",
        },
        navy: {
          950: "#0a1a33",
          900: "#0f2a52",
          800: "#123a6b",
          700: "#164a85",
          600: "#1a5aa0",
          500: "#1f6bbf",
          100: "#e3ecf7",
          50: "#eef3fa",
        },
        gold: {
          600: "#a1750f",
          500: "#c8952a",
          400: "#d8ab4f",
          300: "#e6c47c",
          100: "#f7ecd2",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15, 42, 82, 0.04), 0 1px 3px 0 rgba(15, 42, 82, 0.08)",
        panel: "0 4px 16px -4px rgba(15, 42, 82, 0.12)",
      },
      fontSize: {
        "2xs": "0.6875rem",
      },
    },
  },
  plugins: [],
};
