import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const adapter = new PrismaMariaDb({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "netfault_ai",
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const devices = [
    {
      name: "Core-Router-01",
      type: "router" as const,
      ipAddress: "192.168.1.1",
      location: "Server Room",
      interfaces: ["GigabitEthernet0/0", "GigabitEthernet0/1"],
    },
    {
      name: "Core-Switch-01",
      type: "switch" as const,
      ipAddress: "192.168.1.2",
      location: "Server Room",
      interfaces: ["GigabitEthernet0/1", "GigabitEthernet0/2"],
    },
    {
      name: "Edge-Firewall-01",
      type: "firewall" as const,
      ipAddress: "192.168.1.3",
      location: "Network Rack",
      interfaces: ["WAN", "LAN"],
    },
    {
      name: "Office-AP-01",
      type: "access_point" as const,
      ipAddress: "192.168.1.10",
      location: "Office Floor",
      interfaces: ["Wireless"],
    },
    {
      name: "App-Server-01",
      type: "server" as const,
      ipAddress: "192.168.1.20",
      location: "Server Room",
      interfaces: ["Ethernet"],
    },
  ];

  for (const deviceData of devices) {
    const { interfaces, ...device } = deviceData;

    const existingDevice = await prisma.device.findFirst({
      where: {
        ipAddress: device.ipAddress,
      },
    });

    const createdDevice = existingDevice
      ? await prisma.device.update({
          where: {
            id: existingDevice.id,
          },
          data: {
            name: device.name,
            type: device.type,
            location: device.location,
          },
        })
      : await prisma.device.create({
          data: device,
        });

    for (const interfaceName of interfaces) {
      const existingInterface = await prisma.interface.findFirst({
        where: {
          deviceId: createdDevice.id,
          name: interfaceName,
        },
      });

      if (!existingInterface) {
        await prisma.interface.create({
          data: {
            deviceId: createdDevice.id,
            name: interfaceName,
          },
        });
      }
    }

    console.log(`Seeded device: ${createdDevice.name}`);
  }
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
