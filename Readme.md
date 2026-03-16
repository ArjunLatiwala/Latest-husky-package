
---

```markdown
# Secure Husky Setup

Automatically installs and configures:

- Husky (Git hooks)
- Gitleaks (Secret scanning)
- Pre-commit protection

---

## Install from GitHub

Inside your project directory:

```bash
npm install --save-dev git+https://github.com/HUSAINTRIVEDI52/npm-package-husky-gitleaks.git
```


---

## Initialize

The setup automatically configures everything when you install the package via npm!
If you need to run it manually (e.g., if you install it before initializing git), run:

```bash
npx secure-husky-setup init
```

This will:

- Install Husky locally
- Download Gitleaks locally
- Configure the pre-commit hook

---

## Done

Now every `git commit` will automatically scan for secrets.

If secrets are detected, the commit will be blocked.

---

