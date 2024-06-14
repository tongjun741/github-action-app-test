Vagrant.configure("2") do |config|
  config.vm.box = "peru/windows-10-enterprise-x64-eval"
  config.vm.box_version = "20240201.01"

  config.vm.provider :libvirt do |libvirt|
    libvirt.cpus = 4
  end
  
  config.vm.synced_folder "./win7", "/vagrant"
end