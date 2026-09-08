// 3D palette mirrors the CSS theme in globals.css
export const EMBER = "#ff6a3d";
export const CIRCUIT = "#3ee8ff";
export const LIME = "#b8f04a";
export const AMBER = "#ffc260";
export const BG = "#07080d";
// legacy aliases used by the scene files
export const PURPLE = EMBER;
export const GREEN = LIME;
export const BLUE = CIRCUIT;
export const GOLD = AMBER;
export const STATION_GAP = 14;
export const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
