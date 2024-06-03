Vagrant.configure("2") do |config|
  config.vm.box = "tongjun741/win7-node18"
  config.vm.box_version = "20240201"
  config.vm.boot_timeout = 60

  # 修改虚拟机的名称
  config.vm.define "win7"
  config.vm.hostname = "win7-2"
  
  config.vm.provider "virtualbox" do |vb|
    # 禁用USB控制器
    vb.customize ["modifyvm", :id, "--usb", "off"]
    vb.customize ["modifyvm", :id, "--usbxhci", "off"]

    # 开启EFI
    # vb.customize ["modifyvm", :id, "--firmware", "efi"]

    # 设置虚拟视频适配器为VBoxSVGA
    vb.customize ["modifyvm", :id, "--vram", "128"]
    vb.customize ["modifyvm", :id, "--graphicscontroller", "vmsvga"]
    
    # 修改虚拟机的名称
    vb.name = "win7-3"
  
    # 配置为4核4G
    vb.memory = 4096
    vb.cpus = 4
  end
  
  config.vm.synced_folder "./win7", "/vagrant"

end