import js from "@eslint/js";

// Check if TypeScript packages are available
let typescript, typescriptParser;
try {
    typescript = await import("@typescript-eslint/eslint-plugin");
    typescriptParser = await import("@typescript-eslint/parser");
} catch {
    // TypeScript packages not available, will use basic config
    // eslint-disable-next-line no-console
    console.log("TypeScript ESLint packages not found, using basic JavaScript configuration");
}

export default [
    js.configs.recommended,
    {
        files: ["**/*.{js,jsx,mjs,cjs}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                React: "readonly",
                process: "readonly",
                __dirname: "readonly",
                module: "readonly",
                require: "readonly",
                console: "readonly",
                Buffer: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { 
                "varsIgnorePattern": "^React$",
                "argsIgnorePattern": "^_" 
            }],
            "no-undef": "error"
        }
    },
    ...(typescript && typescriptParser ? [{
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parser: typescriptParser,
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                React: "readonly",
                process: "readonly",
                __dirname: "readonly",
                module: "readonly",
                require: "readonly",
                console: "readonly",
                Buffer: "readonly"
            }
        },
        plugins: {
            "@typescript-eslint": typescript
        },
        rules: {
            "no-unused-vars": "off", // Disable for TS, use @typescript-eslint version
            "no-undef": "error",
            "@typescript-eslint/no-unused-vars": ["warn", { 
                "varsIgnorePattern": "^React$",
                "argsIgnorePattern": "^_" 
            }]
        }
    }] : [])
];
