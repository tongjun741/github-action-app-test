Vagrant.configure("2") do |config|
  config.vm.box = "anzz1/win7x64"
  config.vm.box_version = "2023.11.05.0"
  config.ssh.username = "vagrant"
  config.ssh.password = "vagrant"

  config.winrm.username = "vagrant"
  config.winrm.password = "vagrant"
  
  config.vm.provision "file", source: "./win7", destination: "git"
end