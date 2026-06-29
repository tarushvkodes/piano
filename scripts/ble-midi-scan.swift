import CoreBluetooth
import Foundation

final class MidiScanner: NSObject, CBCentralManagerDelegate {
  private var central: CBCentralManager!
  private let midiService = CBUUID(string: "03B80E5A-EDE8-4B33-A751-6CE34EC4C700")
  private let stopAt: Date
  private var seen = Set<UUID>()

  override init() {
    self.stopAt = Date().addingTimeInterval(12)
    super.init()
    self.central = CBCentralManager(delegate: self, queue: .main)
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn:
      print("Scanning for Bluetooth MIDI devices for 12 seconds...")
      central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
      Timer.scheduledTimer(withTimeInterval: 12, repeats: false) { _ in
        self.central.stopScan()
        if self.seen.isEmpty {
          print("No Bluetooth MIDI advertisements were seen. Make sure the FP-10 is on and not already locked to another device.")
        }
        CFRunLoopStop(CFRunLoopGetMain())
      }
    default:
      print("Bluetooth central state: \(central.state.rawValue). Turn Bluetooth on and grant Terminal Bluetooth permission if macOS asks.")
      CFRunLoopStop(CFRunLoopGetMain())
    }
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    let serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
    let overflowUUIDs = advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? []
    let allUUIDs = serviceUUIDs + overflowUUIDs
    let name = peripheral.name
      ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String
      ?? "Unnamed"

    let looksRelevant = allUUIDs.contains(midiService)
      || name.localizedCaseInsensitiveContains("FP")
      || name.localizedCaseInsensitiveContains("Roland")
      || name.localizedCaseInsensitiveContains("Piano")

    guard looksRelevant, !seen.contains(peripheral.identifier) else { return }
    seen.insert(peripheral.identifier)

    let uuidList = allUUIDs.map { $0.uuidString }.joined(separator: ", ")
    print("Found: \(name)")
    print("  id: \(peripheral.identifier.uuidString)")
    print("  rssi: \(RSSI)")
    print("  services: \(uuidList.isEmpty ? "not advertised" : uuidList)")
    print("  bluetooth-midi-service: \(allUUIDs.contains(midiService) ? "yes" : "not in advertisement")")
  }
}

let scanner = MidiScanner()
CFRunLoopRun()
