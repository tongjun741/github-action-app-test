Win7暂时在所有镜像都不可用

Vagrant 2.3.6

brew uninstall vagrant
wget https://releases.hashicorp.com/vagrant/2.3.6/vagrant_2.3.6_darwin_amd64.dmg
hdiutil attach vagrant_2.3.6_darwin_amd64.dmg
sudo installer -pkg /Volumes/Vagrant/vagrant.pkg -target /
hdiutil detach /Volumes/Vagrant/
vagrant --version


Vagrant.configure("2") do |config|
  config.vm.box = "anzz1/win7x64"
  config.vm.box_version = "2023.11.05.0"
end

设计一个github action，每30分钟检查一个https://dev.thinkoncloud.cn/downloads/win10_app_zh/HuaYoungApp_Win10_dev_zh_setup.exe的last-modified是否有新的变化，如果有执行下面的任务。当前有任务在执行时不要启动新任务

vagrant package --base win7-xx_default_1706059625611_13898 --output w1852.box


config.vm.provider "virtualbox" do |v|

  v.memory = 8192

  v.cpus = 4

end


vagrant package --base  Windows7-NodeJS18 --output win7-1537.box


vagrant box add --name w1949  /d/VirtualBox\ VMs/Win7-nodeJS18/win7-1949.box
vagrant init w1949
vagrant up


vagrant powershell -c "pwd"
vagrant powershell -c "node -v"

https://blog.unclezs.com/pages/dbdf90/#%E6%B7%BB%E5%8A%A0%E5%88%B0-box

vagrant rpd

Restart-Computer

ssh -p5922 -R 33389:127.0.0.1:3389 tongjun@ds.0728123.xyz

ssh -L 33389:127.0.0.1:33389 nas


Vagrant.configure("2") do |config|
  config.vm.box = "anzz1/win7x64"   没有补丁？
  config.vm.box_version = "2023.11.05.0"
end

 config.vm.box = "romaxa55/Windows7_SP1_Ultimate_x86"  启动不了
 
 
  config.vm.box = "jgastald/win7-Plantilla"  启动不了
  
  
  config.vm.box = "danimaetrix/windows-7-ultimate"  启动不了
  vagrant plugin install vagrant-vbguest
  
  
  config.vm.box = "d1vious/windows_7"  启动不了
  
  config.vm.box = "zolthun/windows-7-sp1-es-64bits" 启动不了
  
  
  config.vm.box = "alex-ks02/win7sp1x86enUpd" 启动不了
  
  config.vm.box = "ramreddy06/windows7-sp1" 启动不了
  
  
  config.vm.box = "cylussec/Windows_7_SP1_x64"  下载不了
  config.vm.box = "automation-stack/w7"
  
  VBoxManage list vms | awk '{print $1}' | xargs -I {} VBoxManage unregistervm --delete {}
  
  ps aux | grep VBox
  