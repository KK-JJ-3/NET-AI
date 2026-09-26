import { Plus } from "lucide-react";

import DeviceCard from "./DeviceCard";

function DeviceList({
  devices,
  onSelectDevice,
  onEditDevice,
  onDeleteDevice,
  onAddDevice,
}) {
  return (
    <div className="device-grid">
      {devices.map((device) => (
        <DeviceCard
          key={device.id}
          device={device}
          onSelectDevice={onSelectDevice}
          onEditDevice={onEditDevice}
          onDeleteDevice={onDeleteDevice}
        />
      ))}

      <button
        type="button"
        className="add-device-card"
        onClick={onAddDevice}
        aria-label="Add a new device"
      >
        <span className="add-device-card-icon">
          <Plus size={28} strokeWidth={2.4} />
        </span>

        <strong>Add Device</strong>

        <span className="add-device-card-description">
          Register a new network device
        </span>
      </button>
    </div>
  );
}

export default DeviceList;
