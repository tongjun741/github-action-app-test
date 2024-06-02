Vagrant.configure("2") do |config|
  config.vm.box = "tongjun741/win7-node18"
  config.vm.box_version = "20240201"
  config.vm.boot_timeout = 60
  
  config.vm.provider "virtualbox" do |vb|
    # 禁用USB控制器
    vb.customize ["modifyvm", :id, "--usb", "off"]
    vb.customize ["modifyvm", :id, "--usbxhci", "off"]
    # 开启EFI
    vb.customize ["modifyvm", :id, "--firmware", "efi"]
  end
  
  # 配置为4核8G
  config.vm.provider "virtualbox" do |v|
    v.memory = 8192
    v.cpus = 4
  end
  
  config.vm.synced_folder "./win7", "/vagrant"

end