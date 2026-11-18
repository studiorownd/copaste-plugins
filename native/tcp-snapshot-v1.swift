import Darwin
import Foundation

struct ProcessIdentity: Encodable {
    let executable: String
    let pid: Int32
    let stamp: String
    let uid: UInt32
}

func processInfo(_ pid: Int32) -> proc_bsdinfo? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size ? info : nil
}

// execFile launches this helper directly. Its parent is the Copaste process requesting the lookup.
func protectedPids() -> Set<Int32>? {
    var seen: Set<Int32> = [getpid()]
    var pid = getppid()
    while pid > 1 {
        guard seen.count < 32, seen.insert(pid).inserted, let info = processInfo(pid) else { return nil }
        pid = Int32(info.pbi_ppid)
    }
    return seen
}

func ownedProcessInfo(_ pid: Int32, uid: UInt32) -> proc_bsdinfo? {
    guard let info = processInfo(pid),
          info.pbi_uid == uid, info.pbi_ruid == uid, info.pbi_svuid == uid else { return nil }
    return info
}

func identity(_ pid: Int32, uid: UInt32) -> ProcessIdentity? {
    guard let before = ownedProcessInfo(pid, uid: uid) else { return nil }
    var path = [UInt8](repeating: 0, count: Int(MAXPATHLEN) * 4)
    let length = proc_pidpath(pid, &path, UInt32(path.count))
    guard length > 0, let executable = String(bytes: path.prefix(Int(length)), encoding: .utf8),
          let after = ownedProcessInfo(pid, uid: uid),
          before.pbi_start_tvsec == after.pbi_start_tvsec,
          before.pbi_start_tvusec == after.pbi_start_tvusec else { return nil }
    return ProcessIdentity(
        executable: executable,
        pid: pid,
        stamp: "\(after.pbi_start_tvsec):\(after.pbi_start_tvusec)",
        uid: uid
    )
}

func inspect(_ candidates: ArraySlice<String>, uid: UInt32) throws -> Data {
    guard uid > 0, candidates.count <= 100, let protected = protectedPids() else {
        return Data("[]".utf8)
    }
    let processes = candidates.compactMap { value -> ProcessIdentity? in
        guard let pid = Int32(value), pid > 1, !protected.contains(pid) else { return nil }
        return identity(pid, uid: uid)
    }
    return try JSONEncoder().encode(processes)
}

enum SnapshotError: Error {
    case invalidRequest
    case listFailed
    case listTimedOut
    case outputTooLarge
}

// Drain both streams concurrently so stderr cannot block the child. The local deadline is
// shorter than Copaste's IPC deadline so the helper can stop lsof before the host aborts it.
func capture(_ pipes: [Pipe], whileRunning process: Process) throws -> [Data] {
    let limits = [1024 * 1024, 64 * 1024]
    var descriptors = pipes.map { pollfd(fd: $0.fileHandleForReading.fileDescriptor, events: Int16(POLLIN), revents: 0) }
    var output = pipes.map { _ in Data() }
    var buffer = [UInt8](repeating: 0, count: 8192)
    let deadline = DispatchTime.now() + .seconds(2)

    while descriptors.contains(where: { $0.fd >= 0 }) || process.isRunning {
        guard DispatchTime.now() < deadline else { throw SnapshotError.listTimedOut }
        if poll(&descriptors, nfds_t(descriptors.count), 20) < 0 {
            if errno == EINTR { continue }
            throw SnapshotError.listFailed
        }
        for index in descriptors.indices where descriptors[index].revents != 0 {
            let fd = descriptors[index].fd
            let count = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if count < 0 {
                if errno == EINTR { continue }
                throw SnapshotError.listFailed
            }
            if count == 0 {
                descriptors[index].fd = -1
                continue
            }
            guard output[index].count + count <= limits[index] else { throw SnapshotError.outputTooLarge }
            output[index].append(contentsOf: buffer.prefix(count))
        }
    }
    return output
}

func list(_ arguments: ArraySlice<String>, uid: UInt32) throws -> Data {
    guard arguments.count <= 1 else { throw SnapshotError.invalidRequest }
    guard uid > 0 else { return Data() }
    var flags = ["-nP", "-a", "-u", String(uid), "-iTCP", "-sTCP:LISTEN", "-Fpcun"]
    if let rawPid = arguments.first {
        guard let pid = Int32(rawPid), pid > 1 else { throw SnapshotError.invalidRequest }
        flags += ["-p", String(pid)]
    }

    let process = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
    process.arguments = flags
    process.environment = ["LC_ALL": "C"]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = stdout.fileHandleForWriting
    process.standardError = stderr.fileHandleForWriting
    try process.run()
    defer { if process.isRunning { process.terminate() } }
    try stdout.fileHandleForWriting.close()
    try stderr.fileHandleForWriting.close()

    let output = try capture([stdout, stderr], whileRunning: process)
    process.waitUntilExit()
    guard process.terminationReason == .exit else { throw SnapshotError.listFailed }
    if process.terminationStatus == 0 { return output[0] }
    // lsof exits 1 for a successful scan with no matches.
    if process.terminationStatus == 1,
       String(decoding: output[1], as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return output[0]
    }
    throw SnapshotError.listFailed
}

let uid = getuid()
let arguments = CommandLine.arguments.dropFirst()
let parameters = arguments.dropFirst()
do {
    let output: Data
    switch arguments.first {
    case "list": output = try list(parameters, uid: uid)
    case "inspect": output = try inspect(parameters, uid: uid)
    default: throw SnapshotError.invalidRequest
    }
    try FileHandle.standardOutput.write(contentsOf: output)
} catch SnapshotError.invalidRequest {
    FileHandle.standardError.write(Data("Usage: tcp-snapshot-v1 list [pid] | inspect [pid ...]\n".utf8))
    exit(64)
} catch SnapshotError.listTimedOut {
    FileHandle.standardError.write(Data("TCP snapshot timed out.\n".utf8))
    exit(74)
} catch {
    FileHandle.standardError.write(Data("TCP snapshot unavailable.\n".utf8))
    exit(74)
}
