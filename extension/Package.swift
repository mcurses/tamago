// swift-tools-version: 6.0
// Tama as a widget for meum (the card under meum's sidebar). Build and install it with
//   scripts/build-meum-widget.sh
// It needs meum's MeumKit package: a checkout at ../../meum (next to this repo), or MEUM_KIT_PATH.
// The cmux sidebar isn't built from here; see scripts/build-extension.sh.
import Foundation
import PackageDescription

let meumKit = ProcessInfo.processInfo.environment["MEUM_KIT_PATH"] ?? "../../meum"

let package = Package(
    name: "TamagoMeum",
    platforms: [.macOS(.v14)],
    products: [.library(name: "TamagoMeum", type: .dynamic, targets: ["TamagoMeum"])],
    dependencies: [.package(path: meumKit)],
    targets: [
        .target(
            name: "TamagoMeum",
            dependencies: [.product(name: "MeumKit", package: "meum")],
            path: ".",
            sources: ["Sources/Pet.swift", "Sources/PetModel.swift", "Sources/PetFooter.swift", "Sources/DaemonClient.swift", "Meum/TamagoWidget.swift"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
