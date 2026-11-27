import http from "k6/http";
import exec from "k6/execution";
import { check } from "k6";
import { Counter } from "k6/metrics";
import {
  BASE_URL,
  FORWARDED_POOL_SIZE,
  MAX_VUS,
  P95_MS,
  PRE_ALLOCATED_VUS,
  ROUTES,
  ROUTE_SLOTS,
  STAGES,
  forwardedAddress,
} from "../lib/config.js";

const rateLimited = new Counter("rate_limited");

const p95 = [`p(95)<${P95_MS}`];

const scenarios = {};
const thresholds = {
  http_req_failed: ["rate<0.01"],
  http_req_duration: p95,
  rate_limited: ["count<1"],
  checks: ["rate>0.99"],
};

for (const { name, rate, duration, startTime } of STAGES) {
  scenarios[name] = {
    executor: "constant-arrival-rate",
    exec: "publicRead",
    rate,
    timeUnit: "1s",
    duration,
    startTime,
    preAllocatedVUs: PRE_ALLOCATED_VUS,
    maxVUs: MAX_VUS,
    gracefulStop: "10s",
  };
  thresholds[`http_req_duration{scenario:${name}}`] = p95;
  thresholds[`http_req_failed{scenario:${name}}`] = ["rate<0.01"];
  thresholds[`http_reqs{scenario:${name}}`] = ["count>=0"];
  thresholds[`dropped_iterations{scenario:${name}}`] = ["count>=0"];
}

for (const { route } of ROUTES) {
  thresholds[`http_req_duration{route:${route}}`] = p95;
}

export const options = {
  scenarios,
  thresholds,
  discardResponseBodies: true,
};

export function publicRead() {
  const entry = ROUTE_SLOTS[exec.scenario.iterationInTest % ROUTE_SLOTS.length];
  const variant =
    entry.variants[Math.floor(Math.random() * entry.variants.length)];
  const url = variant
    ? `${BASE_URL}${entry.path}?${variant}`
    : `${BASE_URL}${entry.path}`;
  const forwarded = forwardedAddress(
    Math.floor(Math.random() * FORWARDED_POOL_SIZE),
  );

  const response = http.get(url, {
    headers: { "X-Forwarded-For": forwarded },
    tags: { route: entry.route, name: entry.path },
  });

  if (response.status === 429) {
    rateLimited.add(1, { route: entry.route });
  }

  check(response, { "status is 200": (r) => r.status === 200 });
}
