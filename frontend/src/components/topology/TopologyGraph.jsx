import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";

import { DeviceTypeIcon } from "../ui/NetworkUI";

const STATUS_CONFIG = {
  up: {
    label: "Normal",
    className: "topology-node-normal",
    icon: CheckCircle2,
  },

  degraded: {
    label: "Warning",
    className: "topology-node-warning",
    icon: AlertTriangle,
  },

  down: {
    label: "Critical",
    className: "topology-node-critical",
    icon: XCircle,
  },

  unknown: {
    label: "Unknown",
    className: "topology-node-unknown",
    icon: CircleHelp,
  },
};

/*
 * ---------------------------------------------------------
 * FABRICATED TOPOLOGY POSITIONS
 * ---------------------------------------------------------
 *
 * These positions are visual only.
 *
 * The layout is intentionally compact so the network stays
 * grouped around the center instead of spreading across the
 * entire graph.
 */

const POSITION_LAYOUTS = {
  1: [{ x: 50, y: 50 }],

  2: [
    { x: 50, y: 50 },
    { x: 70, y: 50 },
  ],

  3: [
    { x: 50, y: 50 },
    { x: 70, y: 38 },
    { x: 70, y: 62 },
  ],

  4: [
    { x: 50, y: 50 },
    { x: 72, y: 35 },
    { x: 72, y: 65 },
    { x: 28, y: 50 },
  ],

  5: [
    { x: 50, y: 50 },
    { x: 72, y: 32 },
    { x: 72, y: 68 },
    { x: 28, y: 68 },
    { x: 28, y: 32 },
  ],

  6: [
    { x: 50, y: 50 },
    { x: 75, y: 30 },
    { x: 75, y: 70 },
    { x: 25, y: 70 },
    { x: 25, y: 30 },
    { x: 50, y: 82 },
  ],
};

/*
 * More than six devices:
 * keep the layout compact around the center.
 */
function getPosition(index, total) {
  const predefined = POSITION_LAYOUTS[total];

  if (predefined && predefined[index]) {
    return predefined[index];
  }

  if (index === 0) {
    return {
      x: 50,
      y: 50,
    };
  }

  const remaining = total - 1;

  const angle =
    ((index - 1) / Math.max(remaining, 1)) * Math.PI * 2 - Math.PI / 2;

  const radius = total <= 10 ? 27 : 31;

  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
  };
}

function getStatusConfig(status) {
  return (
    STATUS_CONFIG[String(status || "").toLowerCase()] || STATUS_CONFIG.unknown
  );
}

function formatDeviceType(type) {
  return String(type || "device")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/*
 * ---------------------------------------------------------
 * CENTRAL DEVICE
 * ---------------------------------------------------------
 *
 * Router is preferred as the visual center.
 *
 * This is only for visual organization and does not imply
 * that the router is actually connected to every device.
 */

function getCentralDeviceIndex(devices) {
  const routerIndex = devices.findIndex((device) => device.type === "router");

  return routerIndex >= 0 ? routerIndex : 0;
}

function buildTopologyDevices(devices) {
  if (!devices.length) {
    return [];
  }

  const centerIndex = getCentralDeviceIndex(devices);

  const centerDevice = devices[centerIndex];

  const surroundingDevices = devices.filter(
    (_, index) => index !== centerIndex,
  );

  return [centerDevice, ...surroundingDevices];
}

/*
 * ---------------------------------------------------------
 * FABRICATED CONNECTIONS
 * ---------------------------------------------------------
 *
 * IMPORTANT:
 *
 * These links are NOT real network relationships.
 *
 * They exist only to make the topology visually readable.
 *
 * The structure is intentionally a tree:
 *
 *                 CENTER
 *                /      \
 *             CORE      CORE
 *             /           \
 *          ACCESS        ACCESS
 *          /               \
 *       BRANCH            BRANCH
 *
 * Number of links:
 *
 * devices - 1
 *
 * Therefore:
 *
 * 6 devices = 5 links
 * 7 devices = 6 links
 * 8 devices = 7 links
 *
 * This automatically adapts when devices are added/deleted.
 */

function buildConnections(devices) {
  if (devices.length <= 1) {
    return [];
  }

  const connections = [];

  /*
   * First two devices connect directly to the center.
   */
  if (devices.length >= 2) {
    connections.push({
      from: 0,
      to: 1,
      type: "core",
    });
  }

  if (devices.length >= 3) {
    connections.push({
      from: 0,
      to: 2,
      type: "core",
    });
  }

  /*
   * Remaining devices branch from the surrounding nodes.
   *
   * This prevents the topology from becoming a spider web.
   */
  for (let index = 3; index < devices.length; index += 1) {
    const parentIndex = index % 2 === 1 ? 1 : 2;

    connections.push({
      from: parentIndex < devices.length ? parentIndex : 0,

      to: index,

      type: index % 2 === 1 ? "access" : "branch",
    });
  }

  return connections;
}

/*
 * ---------------------------------------------------------
 * TOOLTIP PLACEMENT
 * ---------------------------------------------------------
 *
 * The information card is deliberately kept away from the
 * center of the graph where other nodes are located.
 *
 * left/right placement is preferred because it prevents the
 * card from sitting directly over another node.
 */

function getTooltipPlacement(position) {
  if (position.x >= 65) {
    return "left";
  }

  if (position.x <= 35) {
    return "right";
  }

  /*
   * Bottom-center node.
   */
  if (position.y >= 76) {
    return "top";
  }

  /*
   * Center node.
   *
   * Right side has more free space in the compact layout.
   */
  return "right";
}

function TopologyGraph({ devices = [], onSelectDevice }) {
  if (!devices.length) {
    return (
      <div className="topology-graph topology-graph-empty">
        <div className="topology-graph-empty-icon">
          <CircleHelp size={26} aria-hidden="true" />
        </div>

        <strong>No devices available</strong>

        <span>Add a network device to display it in the topology.</span>
      </div>
    );
  }

  const topologyDevices = buildTopologyDevices(devices);

  const positions = topologyDevices.map((_, index) =>
    getPosition(index, topologyDevices.length),
  );

  const connections = buildConnections(topologyDevices);

  function handleSelectDevice(deviceId) {
    if (typeof onSelectDevice === "function") {
      onSelectDevice(deviceId);
    }
  }

  function handleKeyDown(event, deviceId) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();

      handleSelectDevice(deviceId);
    }
  }

  return (
    <div className="topology-graph" aria-label="Illustrative network topology">
      <div className="topology-static-layout">
        {/* =================================================
            CONNECTION LAYER
            ================================================= */}

        <svg
          className="topology-connections"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {connections.map((connection, index) => {
            const from = positions[connection.from];

            const to = positions[connection.to];

            if (!from || !to) {
              return null;
            }

            return (
              <line
                key={`${connection.from}-${connection.to}-${index}`}
                className={`topology-connection topology-connection--${connection.type}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}
        </svg>

        {/* =================================================
            DEVICE NODES
            ================================================= */}

        {topologyDevices.map((device, index) => {
          const position = positions[index];

          const status = getStatusConfig(device.status);

          const StatusIcon = status.icon;

          const tooltipPlacement = getTooltipPlacement(position);

          return (
            <div
              key={device.id}
              className="topology-node-slot"
              style={{
                left: `${position.x}%`,
                top: `${position.y}%`,
              }}
            >
              <button
                type="button"
                className={`topology-node ${status.className}`}
                onClick={() => handleSelectDevice(device.id)}
                onKeyDown={(event) => handleKeyDown(event, device.id)}
                aria-label={`Open ${device.name} details`}
              >
                <span className="topology-node-icon">
                  <DeviceTypeIcon type={device.type} />
                </span>
              </button>

              {/* =========================================
                    HOVER INFORMATION
                    ========================================= */}

              <div
                className={`topology-node-tooltip topology-node-tooltip--${tooltipPlacement}`}
                role="tooltip"
              >
                <div className="topology-tooltip-header">
                  <strong className="topology-tooltip-name">
                    {device.name}
                  </strong>

                  <span
                    className={`topology-tooltip-status-dot topology-tooltip-status-dot--${device.status || "unknown"}`}
                  />
                </div>

                <span className="topology-tooltip-type">
                  {formatDeviceType(device.type)}
                </span>

                <code className="topology-tooltip-ip">{device.ipAddress}</code>

                {device.location && (
                  <span className="topology-tooltip-location">
                    {device.location}
                  </span>
                )}

                <span
                  className={`topology-tooltip-status topology-tooltip-status--${device.status || "unknown"}`}
                >
                  <StatusIcon size={11} strokeWidth={2.5} aria-hidden="true" />

                  {status.label}
                </span>
              </div>
            </div>
          );
        })}

        {/* =================================================
            TOPOLOGY LABEL
            ================================================= */}

        <div className="topology-relationship-note">
          <span className="topology-relationship-indicator" />

          <span>
            Illustrative topology — connections are simulated for visualization.
          </span>
        </div>
      </div>
    </div>
  );
}

export default TopologyGraph;
