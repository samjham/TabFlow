# TabFlow Native Messaging Host (PowerShell)
#
# Communicates with the TabFlow Chrome extension via Chrome's native messaging
# protocol. Queries Windows for Chrome's total memory usage and returns it.
#
# Native messaging protocol:
#   - Input/output messages are prefixed with a 4-byte (UInt32LE) length header
#   - Followed by a UTF-8 JSON payload of that length

# Force strict error handling
$ErrorActionPreference = "Stop"

# Read the 4-byte length header from stdin
$stdin = [System.Console]::OpenStandardInput()
$headerBytes = New-Object byte[] 4
$bytesRead = $stdin.Read($headerBytes, 0, 4)
if ($bytesRead -lt 4) {
    exit 1
}
$msgLength = [System.BitConverter]::ToUInt32($headerBytes, 0)
if ($msgLength -eq 0 -or $msgLength -gt 1048576) {
    exit 1
}

# Read the JSON message body
$bodyBytes = New-Object byte[] $msgLength
$totalRead = 0
while ($totalRead -lt $msgLength) {
    $chunk = $stdin.Read($bodyBytes, $totalRead, ($msgLength - $totalRead))
    if ($chunk -eq 0) { break }
    $totalRead += $chunk
}
$jsonIn = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $totalRead)
$message = $jsonIn | ConvertFrom-Json

# Process the request
$response = @{ success = $false; error = "Unknown action" }

if ($message.action -eq "get_chrome_memory") {
    try {
        $chromeProcs = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
        if ($chromeProcs) {
            $totalBytes = ($chromeProcs | Measure-Object WorkingSet64 -Sum).Sum
            $response = @{
                success = $true
                chromeMemoryBytes = $totalBytes
                platform = "win32"
            }
        } else {
            $response = @{
                success = $true
                chromeMemoryBytes = 0
                platform = "win32"
            }
        }
    } catch {
        $response = @{
            success = $false
            error = $_.Exception.Message
        }
    }
}

# Send the response back using native messaging protocol
$jsonOut = $response | ConvertTo-Json -Compress
$outBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonOut)
$lengthBytes = [System.BitConverter]::GetBytes([uint32]$outBytes.Length)

$stdout = [System.Console]::OpenStandardOutput()
$stdout.Write($lengthBytes, 0, 4)
$stdout.Write($outBytes, 0, $outBytes.Length)
$stdout.Flush()

exit 0
