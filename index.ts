import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const WHEELS_BASE_URL = "https://engine.justusewheels.com";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const server = new McpServer(
  {
    name: "wheels-router-mcp",
    version: "0.3.0",
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);

const PlanTripSchema = z
  .object({
    origin: z
      .string()
      .min(3)
      .describe(
        "Required. Starting point as 'lat,lon' or 'stop:ID'. Use coordinates or stop IDs only."
      ),
    destination: z
      .string()
      .min(3)
      .describe(
        "Required. Destination as 'lat,lon' or 'stop:ID'. Use coordinates or stop IDs only."
      ),
    depart_at: z
      .string()
      .datetime({ offset: true })
      .describe("Optional ISO 8601 departure time (UTC preferred).")
      .optional(),
    arrive_by: z
      .string()
      .datetime({ offset: true })
      .describe("Optional ISO 8601 arrival deadline (UTC preferred).")
      .optional(),
    modes: z
      .string()
      .describe(
        "Optional comma-separated modes (e.g. 'mtr,bus,ferry'). Only set if needed."
      )
      .optional(),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe("Optional cap on returned plans (1-5). Defaults to API behavior.")
      .optional(),
  })
  .refine(
    (input) => !(input.depart_at && input.arrive_by),
    "Use only one of depart_at or arrive_by."
  );

const SearchLocationSchema = z.object({
  query: z
    .string()
    .min(2)
    .describe("Free-text place search. Example: 'Yau Tong MTR Exit A2'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("How many results to return (1-10)."),
});

const cleanPoint = (point: any) =>
  point && typeof point === "object"
    ? { lat: point.lat, lon: point.lon }
    : undefined;

const cleanLocation = (loc: any) =>
  loc && typeof loc === "object"
    ? {
        address: loc.address,
        id: loc.id,
        stop_id: loc.stop_id,
        entrance: loc.entrance,
        platform: loc.platform,
        location: cleanPoint(loc.location),
      }
    : undefined;

const cleanStop = (stop: any) =>
  stop && typeof stop === "object"
    ? {
        id: stop.id,
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        platform: stop.platform,
        location: cleanPoint(stop.location),
      }
    : undefined;

const simplifyLeg = (leg: any) => {
  if (!leg || typeof leg !== "object") {
    return undefined;
  }

  switch (leg.type) {
    case "walk":
      return {
        type: "walk",
        walk_type: leg.walk_type,
        duration_seconds: leg.duration_seconds,
        distance_meters: leg.distance_meters,
        from: cleanLocation(leg.from),
        to: cleanLocation(leg.to),
      };
    case "transit":
      return {
        type: "transit",
        route_options: Array.isArray(leg.route_options)
          ? leg.route_options.map((opt: any) => ({
              route_id: opt.route_id,
              route_name: opt.route_name,
              route_short_name: opt.route_short_name,
              headsign: opt.headsign,
              mode: opt.mode,
              duration_seconds: opt.duration_seconds,
              start_time: opt.start_time,
              fare:
                opt.fare && typeof opt.fare === "object"
                  ? { final_fare: opt.fare.final_fare, currency: opt.fare.currency }
                  : undefined,
              from: cleanStop(opt.from),
              to: cleanStop(opt.to),
            }))
          : [],
      };
    case "wait":
      return {
        type: "wait",
        duration_seconds: leg.duration_seconds,
      };
    case "station_transfer":
      return {
        type: "station_transfer",
        from_platform: leg.from_platform,
        to_platform: leg.to_platform,
        duration_seconds: leg.duration_seconds,
        distance_meters: leg.distance_meters,
      };
    default:
      return { type: leg.type, duration_seconds: leg.duration_seconds };
  }
};

const simplifyPlanResponse = (data: any) => {
  if (!data || !Array.isArray(data.plans)) {
    return { plans: [] };
  }

  return {
    plans: data.plans.map((plan: any) => ({
      duration_seconds: plan.duration_seconds,
      duration_seconds_min: plan.duration_seconds_min,
      duration_seconds_max: plan.duration_seconds_max,
      start_time: plan.start_time,
      fares_min: plan.fares_min,
      fares_max: plan.fares_max,
      currency: plan.currency,
      legs: Array.isArray(plan.legs)
        ? plan.legs
            .map((leg: any) => simplifyLeg(leg))
            .filter((leg: any) => !!leg)
        : [],
    })),
  };
};

server.tool(
  "plan_trip",
  "Plan a Wheels Router trip (origin & destination required; avoids extra options unless explicitly set).",
  PlanTripSchema,
  async ({ origin, destination, depart_at, arrive_by, modes, max_results }) => {
    const params = new URLSearchParams();
    params.set("origin", origin);
    params.set("destination", destination);
    if (depart_at) params.set("depart_at", depart_at);
    if (arrive_by) params.set("arrive_by", arrive_by);
    if (modes) params.set("modes", modes);
    if (max_results) params.set("max_results", String(max_results));

    const url = `${WHEELS_BASE_URL}/v1/plan?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "wheels-router-mcp/0.3.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Wheels Router error ${response.status}: ${message}`);
    }

    const data = await response.json();
    const simplified = simplifyPlanResponse(data);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(simplified, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "search_location",
  "Search locations via Nominatim (use for origin/destination lookup).",
  SearchLocationSchema,
  async ({ query, limit }) => {
    const params = new URLSearchParams({
      format: "jsonv2",
      q: query,
      limit: String(limit ?? 5),
      addressdetails: "1",
    });

    const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": "wheels-router-mcp/0.3.0",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Nominatim error ${response.status}: ${message}`);
    }

    const results = await response.json();
    const simplified = Array.isArray(results)
      ? results.map((item) => ({
          display_name: item.display_name,
          lat: item.lat,
          lon: item.lon,
          type: item.type,
          class: item.class,
        }))
      : [];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(simplified, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "hello_tool",
  "Hello tool",
  {
    name: z.string().describe("The name of the person to greet"),
  },
  async ({ name }) => {
    console.error("Hello tool", { name });
    return {
      content: [
        {
          type: "text",
          text: `Hello, ${name}!`,
        },
      ],
    };
  }
);

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Wheels Router MCP server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
