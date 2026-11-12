import { Writable } from "node:stream";

export const captureLogs = () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    lines: () => chunks.join("").split("\n").filter(Boolean),
    output: () => chunks.join(""),
  };
};
