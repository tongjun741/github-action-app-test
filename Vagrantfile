Vagrant.configure("2") do |config|
  config.vm.box = "datacastle/windows7"
  config.vm.box_version = "1.0"
  
  config.vm.provider "virtualbox" do |v|
    v.memory = 1024
    v.cpus = 1
  end
  
  config.vm.provision "file", source: "~/", destination: "git"
end