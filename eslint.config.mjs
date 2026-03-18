import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

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
        }
    },
    {
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
            "no-unused-vars": ["warn", { 
                "varsIgnorePattern": "^React$",
                "argsIgnorePattern": "^_" 
            }],
            "no-undef": "error",
            "@typescript-eslint/no-unused-vars": ["warn", { 
                "varsIgnorePattern": "^React$",
                "argsIgnorePattern": "^_" 
            }]
        }
    }
];
