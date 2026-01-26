import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const WHEELS_BASE_URL = "https://engine.justusewheels.com";
const TRANSITOUS_BASE_URL = "https://api.transitous.org";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const cleanPoint = (point: any) =>
  point && typeof point === "object" ? { lat: point.lat, lon: point.lon } : undefined;

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

const isInHongKong = (lat: number, lon: number): boolean => {
  return lat >= 22.15 && lat <= 22.58 && lon >= 113.82 && lon <= 114.45;
};

const parseCoordinates = (input: string): { lat: number; lon: number } | null => {
  const match = input.match(/^(-?\d+\.?\d*),(-?\d+\.?\d*)$/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  return { lat, lon };
};

const transitousModeToWheelsMode = (mode: string): string => {
  const modeMap: Record<string, string> = {
    TRAM: "tram",
    SUBWAY: "subway",
    BUS: "bus",
    FERRY: "ferry",
    AIRPLANE: "air",
    COACH: "coach",
    RAIL: "mtr",
    SUBURBAN: "mtr",
    HIGHSPEED_RAIL: "mtr",
    LONG_DISTANCE: "mtr",
    NIGHT_RAIL: "mtr",
    REGIONAL_FAST_RAIL: "mtr",
    REGIONAL_RAIL: "mtr",
    CABLE_CAR: "funicular",
    FUNICULAR: "funicular",
    AERIAL_LIFT: "funicular",
  };
  return modeMap[mode] || mode.toLowerCase();
};

const convertTransitousLeg = (leg: any) => {
  const mode = leg.mode;
  const isTransit = !["WALK", "BIKE", "CAR", "RENTAL"].includes(mode);

  if (!isTransit) {
    return {
      type: "walk",
      walk_type: mode === "WALK" ? "street" : mode.toLowerCase(),
      duration_seconds: leg.duration,
      distance_meters: leg.distance,
      from: {
        address: leg.from.name,
        id: leg.from.stopId,
        location: { lat: leg.from.lat, lon: leg.from.lon },
      },
      to: {
        address: leg.to.name,
        id: leg.to.stopId,
        location: { lat: leg.to.lat, lon: leg.to.lon },
      },
    };
  }

  return {
    type: "transit",
    route_options: [
      {
        route_id: leg.tripId,
        route_name: leg.routeLongName || leg.routeShortName || leg.displayName,
        route_short_name: leg.routeShortName,
        headsign: leg.headsign,
        mode: transitousModeToWheelsMode(mode),
        duration_seconds: leg.duration,
        start_time: leg.startTime,
        fare: undefined,
        from: {
          id: leg.from.stopId,
          stop_name: leg.from.name,
          platform: leg.from.track,
          location: { lat: leg.from.lat, lon: leg.from.lon },
        },
        to: {
          id: leg.to.stopId,
          stop_name: leg.to.name,
          platform: leg.to.track,
          location: { lat: leg.to.lat, lon: leg.to.lon },
        },
      },
    ],
  };
};

const convertTransitousResponse = (data: any, maxResults?: number) => {
  if (!data || !Array.isArray(data.itineraries)) {
    return { plans: [] };
  }

  const itineraries = data.itineraries.slice(0, maxResults || data.itineraries.length);

  return {
    plans: itineraries.map((itinerary: any) => ({
      duration_seconds: itinerary.duration,
      duration_seconds_min: itinerary.duration,
      duration_seconds_max: itinerary.duration,
      start_time: itinerary.startTime,
      fares_min: undefined,
      fares_max: undefined,
      currency: undefined,
      legs: Array.isArray(itinerary.legs)
        ? itinerary.legs.map((leg: any) => convertTransitousLeg(leg)).filter((leg: any) => !!leg)
        : [],
    })),
  };
};

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
                  ? {
                      base_fare: opt.fare.base_fare,
                      discount: opt.fare.discount,
                      final_fare: opt.fare.final_fare,
                      currency: opt.fare.currency,
                    }
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
        ? plan.legs.map((leg: any) => simplifyLeg(leg)).filter((leg: any) => !!leg)
        : [],
    })),
  };
};

function createServer() {
  const server = new Server(
    {
      name: "wheels-router-mcp",
      version: "0.4.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler("tools/list", async () => ({
    tools: [
      {
        name: "plan_trip",
        description:
          "Plan a transit trip. Uses Wheels Router for Hong Kong and Transitous for other regions. IMPORTANT: fares_min/fares_max are fare ranges, NOT interchange discounts. Interchange discounts (轉乘優惠) only apply when FareDiscountRules are explicitly present in the API response, and IT ONLY APPLIES TO CERTAIN ROUTES.",
        inputSchema: {
          type: "object",
          properties: {
            origin: {
              type: "string",
              description:
                "Required. Starting point as 'lat,lon' or 'stop:ID'. Use coordinates or stop IDs only.",
            },
            destination: {
              type: "string",
              description:
                "Required. Destination as 'lat,lon' or 'stop:ID'. Use coordinates or stop IDs only.",
            },
            depart_at: {
              type: "string",
              description: "Optional ISO 8601 departure time (UTC preferred).",
            },
            arrive_by: {
              type: "string",
              description: "Optional ISO 8601 arrival deadline (UTC preferred).",
            },
            modes: {
              type: "string",
              description:
                "Optional comma-separated modes (e.g. 'mtr,bus,ferry'). Only set if needed.",
            },
            max_results: {
              type: "number",
              description: "Optional cap on returned plans (1-5). Defaults to API behavior.",
            },
          },
          required: ["origin", "destination"],
        },
      },
      {
        name: "search_location",
        description: "Search locations via Nominatim (use for origin/destination lookup).",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Free-text place search. Example: 'Yau Tong MTR Exit A2' or 'Tokyo Station'.",
            },
            limit: {
              type: "number",
              description: "How many results to return (1-10).",
              default: 5,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "hello_tool",
        description: "Hello tool",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the person to greet",
            },
          },
          required: ["name"],
        },
      },
    ],
  }));

  server.setRequestHandler("tools/call", async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "plan_trip") {
      const { origin, destination, depart_at, arrive_by, modes, max_results } = args as any;

      const originCoords = parseCoordinates(origin);
      const destinationCoords = parseCoordinates(destination);

      const useWheelsRouter =
        originCoords &&
        destinationCoords &&
        isInHongKong(originCoords.lat, originCoords.lon) &&
        isInHongKong(destinationCoords.lat, destinationCoords.lon);

      if (useWheelsRouter) {
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
            "User-Agent": "wheels-router-mcp/0.4.0",
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
      } else {
        const params = new URLSearchParams();
        params.set("fromPlace", origin);
        params.set("toPlace", destination);
        params.set("detailedTransfers", "true");

        if (depart_at) {
          params.set("time", depart_at);
          params.set("arriveBy", "false");
        } else if (arrive_by) {
          params.set("time", arrive_by);
          params.set("arriveBy", "true");
        }

        if (max_results) {
          params.set("numItineraries", String(max_results));
        }

        const url = `${TRANSITOUS_BASE_URL}/api/v5/plan?${params.toString()}`;

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": "wheels-router-mcp/0.4.0",
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(`Transitous error ${response.status}: ${message}`);
        }

        const data = await response.json();
        const simplified = convertTransitousResponse(data, max_results);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(simplified, null, 2),
            },
          ],
        };
      }
    }

    if (name === "search_location") {
      const { query, limit } = args as any;
      const searchQuery = query;

      const params = new URLSearchParams({
        format: "jsonv2",
        q: searchQuery,
        limit: String(limit ?? 5),
        addressdetails: "1",
      });

      const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
        headers: {
          "User-Agent": "wheels-router-mcp/0.4.0",
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

    if (name === "hello_tool") {
      const { name: personName } = args as any;
      return {
        content: [
          {
            type: "text",
            text: `Hello, ${personName}!`,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check endpoint
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          name: "wheels-router-mcp",
          version: "0.4.0",
          status: "ok",
          endpoints: {
            mcp: "/mcp",
            sse: "/sse",
          },
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // MCP endpoint - supports both /mcp and /sse
    if (url.pathname === "/mcp" || url.pathname === "/sse") {
      if (request.method === "POST") {
        try {
          const server = createServer();
          const transport = new SSEServerTransport("/message", request);
          await server.connect(transport);

          return new Response(transport.response.body, {
            headers: {
              ...corsHeaders,
              ...Object.fromEntries(transport.response.headers.entries()),
            },
          });
        } catch (error) {
          console.error("MCP error:", error);
          return new Response(
            JSON.stringify({
              error: "Internal server error",
              message: error instanceof Error ? error.message : String(error),
            }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }

      // GET request - return info about the MCP server
      return new Response(
        JSON.stringify({
          name: "wheels-router-mcp",
          version: "0.4.0",
          protocol: "mcp",
          transport: "sse",
          description: "MCP server for global public transit routing",
          tools: ["plan_trip", "search_location", "hello_tool"],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};
