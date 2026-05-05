import dotenv from "dotenv";

let loaded = false;

export function loadEnvironment(): void {
  if (loaded) {
    return;
  }

  const explicitOverride = (process.env.DOTENV_OVERRIDE || "").toLowerCase() === "true";
  dotenv.config({ override: explicitOverride });
  loaded = true;
}

loadEnvironment();
