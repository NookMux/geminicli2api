import os from 'os';
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  console.log(JSON.stringify(interfaces, null, 2))
  if (interfaces.WLAN) {
    for (const inter of interfaces.WLAN) {
      if (inter.family === 'IPv4' && !inter.internal) {
        return inter.address;
      }
    }
  } else if (interfaces.wlan2) {
    for (const inter of interfaces.wlan2) {
      if (inter.family === 'IPv4' && !inter.internal) {
        return inter.address;
      }
    }
    return '127.0.0.1';
  }
}

console.log(getLocalIp());
