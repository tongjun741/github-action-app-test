#!/bin/bash

# A cleaner alternative to this approach, but which requires a restart, is to populate TCC's SiteOverrides.plist inside
# the TCC app support directory with the following:
# <?xml version="1.0" encoding="UTF-8"?>
# <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
# <plist version="1.0">
# <dict>
# 	<key>Services</key>
# 		<dict>
# 		<key>PostEvent</key>
# 		<array>
# 			<dict>
# 				<key>Allowed</key>
# 				<true/>
# 				<key>CodeRequirement</key>
# 				<string>identifier "com.apple.screensharing.agent" and anchor apple</string>
# 				<key>Identifier</key>
# 				<string>com.apple.screensharing.agent</string>
# 				<key>IdentifierType</key>
# 				<string>bundleID</string>
# 			</dict>
# 		</array>
# 		<key>ScreenCapture</key>
# 		<array>
# 			<dict>
# 				<key>Allowed</key>
# 				<true/>
# 				<key>CodeRequirement</key>
# 				<string>identifier "com.apple.screensharing.agent" and anchor apple</string>
# 				<key>Identifier</key>
# 				<string>com.apple.screensharing.agent</string>
# 				<key>IdentifierType</key>
# 				<string>bundleID</string>
# 			</dict>
# 		</array>
# 	</dict>
# </dict>
# </plist>

set -eux -o pipefail

db_path="/Library/Application Support/com.apple.TCC/TCC.db"

sanity_checks() {
  os_ver_major="$(sw_vers -productVersion | awk -F'.' '{print $1}')"
  if [[ "${os_ver_major}" -ne 12 ]]; then
    echo "This script is only tested valid on macOS 12, and we detected this system runs version ${os_ver_major}. Exiting."
    exit 1
  fi

  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Need to run this script as root... exiting"
    exit 1
  fi

  # TODO: we should bail if we determine we don't have write access to the TCC db (we want to get specific SIP disable status
  #       for whatever is the protection for TCC)
}

disable_screensharing() {
  launchctl unload -w /System/Library/LaunchDaemons/com.apple.screensharing.plist
  sqlite3 "${db_path}" \
    "BEGIN TRANSACTION; \
     DELETE FROM access WHERE client = 'com.apple.screensharing.agent'; \
     COMMIT;"
}

enable_screensharing() {
  launchctl load -w /System/Library/LaunchDaemons/com.apple.screensharing.plist

  epoch="$(date +%s)"
  sqlite3 "${db_path}" \
    "BEGIN TRANSACTION; \
     DELETE FROM access WHERE client = 'com.apple.screensharing.agent'; \
     COMMIT; \

     BEGIN TRANSACTION; \
     INSERT INTO access VALUES('kTCCServicePostEvent','com.apple.screensharing.agent',0,2,4,1,NULL,NULL,0,'UNUSED',NULL,0,${epoch}); \
     INSERT INTO access VALUES('kTCCServiceScreenCapture','com.apple.screensharing.agent',0,2,4,1,NULL,NULL,0,'UNUSED',NULL,0,${epoch}); \
     COMMIT;"
}


dump_screensharing_entries() {
sqlite3 "${db_path}" \
  "SELECT * FROM access WHERE client = 'com.apple.screensharing.agent';"
}

# uncomment to show existing entries for debugging
# dump_screensharing_entries

sanity_checks

enable_screensharing
# uncomment to disable instead of enable
# disable_screensharing

