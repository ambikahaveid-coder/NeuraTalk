import dotenv from "dotenv";

let loaded = false;

export function loadEnvironment(): void {
  if (loaded) {
    return;
  }

  dotenv.config({ override: true });
  loaded = true;
}

loadEnvironment();
