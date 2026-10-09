/**
 * Renderer entry point. M0 skeleton: a PixiJS stage letterboxed to the desk display
 * with a placeholder sea. Terrain, plants and creatures arrive in R0–R2.
 */
import { Application, Graphics } from "pixi.js";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "./scene";

async function start(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: "#000000", antialias: true });
  app.canvas.dataset.testid = "stage";
  document.body.appendChild(app.canvas);

  const world = new Graphics().rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill("#1d4f7a");
  app.stage.addChild(world);

  const layout = (): void => {
    const fit = fitToViewport(app.screen.width, app.screen.height);
    world.scale.set(fit.scale);
    world.position.set(fit.offsetX, fit.offsetY);
  };
  app.renderer.on("resize", layout);
  layout();
}

void start();
