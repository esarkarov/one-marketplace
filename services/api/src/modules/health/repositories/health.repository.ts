import { pool } from "../../../database/client.js";

export const pingDatabase = () => pool.query("select 1");
