import ImageKit from "@imagekit/nodejs";
import { env } from "../config/env.js";

export const imageKit = new ImageKit({
  privateKey: env.imageKitPrivateKey ?? "",
});
