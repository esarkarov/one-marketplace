export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

export interface JsonObject {
  [key: string]: Json;
}

export type ComponentSchemas = Record<string, JsonObject>;
