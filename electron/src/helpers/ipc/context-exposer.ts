import { exposeCameraContext } from "./camera/camera-context";
import { exposeDatabaseContext } from "./database/database-context";
import { exposeSerialContext } from "./serial/serial-context";
import { exposeThemeContext } from "./theme/theme-context";
import { exposeWindowContext } from "./window/window-context";

export default function exposeContexts() {
    exposeWindowContext();
    exposeThemeContext();
    exposeCameraContext();
    exposeSerialContext();
    exposeDatabaseContext();
}
