import type { Listener } from "../listener";
import { metaWhatsapp } from "./meta-whatsapp";

// Add a listener: create ./<platform>.ts exporting a `Listener`, then list it here. Nothing else changes.
export const listeners: Listener[] = [metaWhatsapp];
