import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1B3A5C",
        ballot: "#F8F6F0",
        stamp: "#C41E3A",
        seal: "#B8860B",
        field: "#E8E5DE",
        precinct: "#2D5A3D",
      },
      fontFamily: {
        display: ["Playfair Display", "serif"],
        body: ["Source Sans 3", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
