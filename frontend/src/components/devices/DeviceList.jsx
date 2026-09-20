import DeviceCard from "./DeviceCard";

function DeviceList({ devices, onSelectDevice }) {
  if (!devices.length) {
    return (
      <div className="device-empty">
        <strong>No matching devices</strong>

        <span>Try another status filter or search term.</span>
      </div>
    );
  }

  return (
    <div className="device-grid">
      {devices.map((device) => (
        <DeviceCard
          key={device.id}
          device={device}
          onSelectDevice={onSelectDevice}
        />
      ))}
    </div>
  );
}

export default DeviceList;
