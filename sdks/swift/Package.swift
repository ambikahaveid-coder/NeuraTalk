// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "NeuraTalkSDK",
    platforms: [
        // async/await URLSession.data(for:) requires iOS 15 / macOS 12;
        // CryptoKit's HMAC requires iOS 13 / macOS 10.15 — the higher bound wins.
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(name: "NeuraTalkSDK", targets: ["NeuraTalkSDK"]),
    ],
    targets: [
        .target(name: "NeuraTalkSDK", dependencies: []),
        .testTarget(name: "NeuraTalkSDKTests", dependencies: ["NeuraTalkSDK"]),
    ]
)
