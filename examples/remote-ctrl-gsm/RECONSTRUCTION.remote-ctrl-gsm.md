## PROJECT DESCRIPTION

A project to enable remote climate and vehicle control for the Mitsubishi Outlander PHEV by bypassing local Wi-Fi restrictions through a VPN tunnel, using a modified Android application and network infrastructure (Mikrotik routers/Cloud).

_Automotive, Android Application Modification, Networking, IoT · Android APK, Java JDK, Docker, VPN, Mikrotik RouterOS, SmartThings_

## Your IMPACT as Staff Developer

I implemented a remote-control system for the Mitsubishi Outlander PHEV to enable remote climate and vehicle control via VPN tunnels and cloud infrastructure, bypassing the native local Wi-Fi restrictions. I began by reverse-engineering the proprietary binary communication protocol between the native Android application and the vehicle module. Using Smali, I modified the APK to remove strict local network dependencies, replacing hardcoded IP addresses with runtime values and redirecting registration data from internal storage to external shared storage to allow for easier portability of the registration state across my own devices.

To support this architecture, I developed cryptographic utilities and a KeyManager singleton for private key generation that adhered to the vehicle module's expected request format. I also implemented a FileNetworkConfig module to handle vehicle MAC and IP addresses from external JSON configurations. I extended the the application's functionality by implementing Theft Alarm control, expanding the network request builder to support new command codes and updating the UI to reflect alarm states.

At the infrastructure layer, I deployed a Docker-based VPN server architecture supporting PPTP and L2TP/IPsec protocols. I developed automated bootstrap scripts for Ubuntu hosts that provisioned these services, configuring kernel modules (nf_nat_pptp, ip_gre), IP forwarding, and persistent iptables rules to route traffic from the host's loopback interface to the containerized VPN services. To simplify deployment, I created a configuration generator for Mikrotik routers to automate router-side settings.

To integrate vehicle controls into my smart-home environment, I integrated a SmartThings application server into the Docker images, allowing for cloud-based triggers and expanding the command set through iterative updates of the `smartthings-phevctl` package. This allowed me to trigger climate functions via the SmartThings interface rather than relying on the binary protocol emulation within the modified Android app.

I managed the full lifecycle of this personal project—from APK patching and binary protocol emulation to network tunneling and CI/CD pipelines via GitHub Actions. To maintain consistency across the diverse technology layers, I centralized hardware identification and configuration values in external files and developed automated build scripts for the APK, Docker images, and router configurations to ensure the end-to-end setup remained reproducible.

## Technologies

Android SDK, Java, Mikrotik RouterOS, Docker, SmartThings

## Impact bullet points (Role Narrative)

- I reverse-engineered a proprietary binary communication protocol between a Mitsubishi Outlander PHEV vehicle module and its native Android application to enable independent request generation and emulation of the native client.
- I modified the Android APK using Smali to remove hardcoded local network dependencies, replacing them with runtime values and redirecting registration data from internal storage to external shared storage for state portability across devices.
- I designed a containerized networking stack on Ubuntu using Docker, implementing L2TP/IPsec VPN tunnels and automated MikroTik router configurations to bypass local Wi-Fi restrictions and enable remote vehicle access via the cloud.
- I integrated a SmartThings application server into the Docker environment, expanding the binary command set to expose vehicle climate and theft alarm controls through a cloud-based interface.

## CV bullets

- Reverse-engineered a proprietary binary communication protocol between a vehicle module and Android application to enable independent request generation.
- Modified an Android APK via Smali to remove local network dependencies and redirect registration data for improved state portability.
- Designed a containerized networking stack using Docker and L2TP/IPsec VPN tunnels to bypass local Wi-Fi restrictions for remote access.
- Integrated a SmartThings application server into the cloud infrastructure to expose vehicle climate and theft alarm controls via a cloud interface.

## Possible questions

**Q:** Given the end-to-end nature of your design—spanning Android, cloud networking, and router configuration—did you intend this architecture to serve as a portable platform/template that could be extended to other vehicle modules or similar IoT bypasses, or was it designed specifically for the Outlander PHEV hardware constraints?
**A:** The project was designed specifically for the Mitsubishi Outlander PHEV.

The original goal was very practical: I wanted to remotely control the heater and air conditioning in my own car and later integrate those controls with SmartThings.

The Mitsubishi Wi-Fi module and the original OUTLANDER_PHEV_REMOTE application had several specific constraints: the app expected a direct local Wi-Fi connection, used a proprietary binary protocol, had device-registration limitations, and depended on Mitsubishi-specific network and hardware identification logic.

Because of that, the protocol reverse engineering, APK modifications, registration handling, MAC-address logic, and binary request emulation were all specific to the Outlander PHEV.

The VPN, Docker, and MikroTik parts were built only to make this particular vehicle module reachable remotely over mobile and cloud networks. I did not design the project as a generic platform for other cars or IoT devices.

So the answer is simple: this was an end-to-end solution for the Mitsubishi Outlander PHEV, built around the exact constraints of its native Android application and Wi-Fi remote-control module.

**Q:** What were the primary drivers behind the shift toward integrating with SmartThings and expanding the command set? Was this project developed to meet specific user requirements from a community of users, or was it as a part of a larger product prototype?
**A:** The project started as a personal project for my own Mitsubishi Outlander PHEV. It was not part of a larger commercial product prototype, and the original requirements did not come from a user community.

The main driver was convenience. I wanted to be able to start the heater or air conditioning remotely before going to the car, especially when the vehicle was parked outside and I wanted it to be warm in winter or cool in summer.

Initially, the modified Mitsubishi application solved the basic remote-access problem. But I was using a Samsung phone and SmartThings, so integrating the vehicle controls with SmartThings was a natural next step. I wanted the car climate functions to become part of the same smart-home and mobile-control environment instead of requiring me to open the modified Mitsubishi application every time.

That is also why the command set expanded. Once I had understood the proprietary binary protocol and could generate requests independently, I was no longer limited to only replaying the original application flow. I could expose the supported vehicle commands through the SmartThings integration and trigger them through the cloud-controlled interface.

So the SmartThings integration was driven primarily by my own usage requirements. The project later became open source and other Outlander PHEV owners could use it, but the architecture and features were initially built to solve a practical problem with my own car rather than to satisfy a predefined community roadmap.

**Q:** When redirecting registration data to external storage and implementing the KeyManager, what security boundaries did you define to prevent unauthorized access to vehicle controls in a shared-storage environment, and how did these standards influence the implementation of the binary protocol emulation?
**A:** I would not describe the external-storage design as a strong security boundary.

The reason I moved the registration data from the application’s private internal storage to external storage was portability. The original Mitsubishi application effectively tied the registration state to one Android installation and limited the number of registered devices. I wanted to be able to copy the registration state between my own devices and reuse the same vehicle registration without repeating the original pairing flow.

That was a conscious trade-off. External storage was easier to access and copy, but it was also less protected than Android application-private storage. I accepted that risk because this was a personal project for my own vehicle and my own devices, not a commercial vehicle-security product.

The important point is that moving the files did not create a new authorization protocol. I preserved the existing Mitsubishi registration and cryptographic behavior as much as possible. The KeyManager and protocol-related code were used to work with the keys and request format expected by the vehicle module rather than to invent a separate access-control layer around the shared storage.

The binary protocol emulation followed the same principle. I first understood how the native application constructed and sent the binary requests, and then reproduced that behavior. I did not intentionally weaken the protocol itself or remove the vehicle module’s existing request validation. The goal was to emulate a registered native client and make the network destination configurable.

So the security model was pragmatic: preserve the vehicle module’s existing protocol and registration mechanism, but make the registration state portable between trusted devices that I controlled.

I would not claim that copying registration data through shared storage is safe for an untrusted multi-user Android environment. If I were designing this today as a commercial product, I would keep the keys and registration state in protected storage, use hardware-backed key management where possible, and implement an explicit device-enrollment and revocation model.

**Q:** You mentioned establishing technical standards for hardware identification and logging across Java and Smali layers; were these standards adopted by other developers contributing to the project, and how did you ensure consistency in implementation as the system evolved?
**A:** This was primarily a personal open-source project, and I was the main and effectively sole developer maintaining it. So I would not describe these patterns as formal engineering standards adopted by a wider development team.

The consistency problem was mostly about keeping several very different layers aligned: modified Android Smali code, Java utilities, external configuration files, MikroTik scripts, Docker images, and cloud networking.

For hardware identification, I tried to centralize the behavior instead of hardcoding different assumptions in multiple places. MAC address, vehicle IP, and port information were moved into external configuration so the Android application and the surrounding network setup could use the same runtime values.

The same principle applied to fallback and logging behavior. When I changed how the application resolved the vehicle MAC address or network endpoint, I updated the Java and Smali paths together and kept the configuration format consistent.

Because the project crossed several technology layers, documentation and automation were important. I added build and signing scripts for the APK, Docker build scripts, MikroTik configuration generators, and README instructions so I could reproduce the full setup after changes without relying on memory.

So consistency was not maintained through team governance or code-review standards. It was maintained by reducing duplicated configuration, centralizing shared values, automating repetitive setup, and documenting the end-to-end deployment path.

Since I was the sole maintainer, these patterns were primarily for long-term maintainability of the project itself rather than for adoption by other developers.

