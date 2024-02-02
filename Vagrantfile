Vagrant.configure("2") do |config|
  config.vm.box = "tongjun741/win7-node18"
  config.vm.box_version = "20240201"
  config.vm.boot_timeout = 60
  
  # 禁用USB控制器
  config.vm.provider "virtualbox" do |vb|
    vb.customize ["modifyvm", :id, "--usb", "off"]
  end
  
  # 配置为4核8G
  config.vm.provider "virtualbox" do |v|
    v.memory = 4092
    v.cpus = 1
  end
  
  config.vm.synced_folder "./win7", "/vagrant"

end