import { QuartzTransformerPlugin } from "../types"

interface Options {
  /** Desmos API key (defaults to demo key) */
  apiKey?: string
}

const defaultOptions: Options = {
  apiKey: "dcb31709b452b1cf9dc26972add0fda6",
}

/**
 * Transforms `desmos-graph` code blocks into interactive Desmos calculator embeds.
 *
 * Supports the obsidian-desmos plugin syntax:
 *   ```desmos-graph
 *   left=-10; right=10; top=5; bottom=-5;
 *   ---
 *   y = \sin(x)
 *   ```
 */
export const DesmosGraphs: QuartzTransformerPlugin<Partial<Options>> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "DesmosGraphs",
    textTransform(_ctx, src) {
      // Replace ```desmos-graph ... ``` blocks with placeholder divs
      // Use a unique class so the client script can find them
      const codeBlockRegex = /```desmos-graph\n([\s\S]*?)```/g

      return src.replace(codeBlockRegex, (_match, content: string) => {
        // Encode the content as base64 to avoid HTML escaping issues
        const encoded = Buffer.from(content.trim()).toString("base64")
        return `<div class="desmos-graph-container" data-desmos="${encoded}" style="width:100%;height:400px;margin:1em 0;border-radius:8px;overflow:hidden;"></div>`
      })
    },
    externalResources() {
      return {
        js: [
          {
            src: `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${opts.apiKey}`,
            loadTime: "afterDOMReady",
            contentType: "external",
            spaPreserve: true,
          },
          {
            script: desmosClientScript,
            loadTime: "afterDOMReady",
            contentType: "inline",
          },
        ],
        css: [],
        additionalHead: [],
      }
    },
  }
}

const desmosClientScript = `
document.addEventListener("nav", () => {
  if (typeof Desmos === "undefined") return;

  const containers = document.querySelectorAll(".desmos-graph-container:not([data-rendered])");
  containers.forEach((container) => {
    container.setAttribute("data-rendered", "true");
    const encoded = container.getAttribute("data-desmos");
    if (!encoded) return;

    let raw;
    try {
      raw = atob(encoded);
    } catch {
      return;
    }

    // Parse settings and equations (split by ---)
    const parts = raw.split("---");
    let settingsStr = "";
    let equationsStr = "";
    if (parts.length >= 2) {
      settingsStr = parts[0].trim();
      equationsStr = parts.slice(1).join("---").trim();
    } else {
      equationsStr = parts[0].trim();
    }

    // Parse settings (key=value pairs separated by ; or newlines)
    const settings = {};
    if (settingsStr) {
      settingsStr.split(/[;\\n]/).forEach((s) => {
        const idx = s.indexOf("=");
        if (idx === -1) return;
        const key = s.slice(0, idx).trim();
        const val = s.slice(idx + 1).trim();
        if (key && val) settings[key] = val;
      });
    }

    // Adjust container height if specified
    if (settings["height"]) {
      container.style.height = settings["height"] + "px";
    }
    if (settings["width"]) {
      container.style.width = settings["width"] + "px";
    }

    // Create Desmos calculator
    const calcOptions = {
      expressions: false,
      keypad: false,
      settingsMenu: false,
      zoomButtons: false,
    };
    if (settings["grid"] === "false") {
      calcOptions.showGrid = false;
    }

    const calculator = Desmos.GraphingCalculator(container, calcOptions);

    // Set math bounds
    const bounds = {};
    ["left", "right", "top", "bottom"].forEach((k) => {
      if (settings[k]) bounds[k] = parseFloat(settings[k]);
    });
    if (Object.keys(bounds).length > 0) {
      calculator.setMathBounds(bounds);
    }

    // Degree mode
    if (settings["degreeMode"] === "degrees") {
      calculator.updateSettings({ degreeMode: true });
    }

    // Color mapping
    const colorMap = {
      RED: Desmos.Colors.RED,
      GREEN: Desmos.Colors.GREEN,
      BLUE: Desmos.Colors.BLUE,
      PURPLE: Desmos.Colors.PURPLE,
      ORANGE: Desmos.Colors.ORANGE,
      BLACK: Desmos.Colors.BLACK,
      YELLOW: "#f5c211",
      MAGENTA: "#ff00ff",
      CYAN: "#00ffff",
      WHITE: "#ffffff",
    };

    // Parse equations line by line
    const lines = equationsStr.split("\\n").filter((l) => l.trim());
    lines.forEach((line, i) => {
      const segments = line.split("|").map((s) => s.trim());
      const latex = segments[0];
      const expr = { id: "expr-" + i, latex: latex };

      segments.slice(1).forEach((mod) => {
        const upper = mod.toUpperCase();
        if (colorMap[upper]) {
          expr.color = colorMap[upper];
        } else if (upper === "DASHED") {
          expr.lineStyle = Desmos.Styles.DASHED;
        } else if (upper === "DOTTED") {
          expr.lineStyle = Desmos.Styles.DOTTED;
        } else if (upper === "HIDDEN") {
          expr.hidden = true;
        } else if (mod.startsWith("label:")) {
          expr.label = mod.slice(6);
          expr.showLabel = true;
        } else if (mod.startsWith("#")) {
          expr.color = mod;
        }
      });

      calculator.setExpression(expr);
    });

    // Cleanup on SPA navigation
    window.addCleanup(() => {
      calculator.destroy();
    });
  });
});
`
