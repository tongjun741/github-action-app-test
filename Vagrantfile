Vagrant.configure("2") do |config|
  config.vm.box = "datacastle/windows7"
  config.vm.box_version = "1.0"
  
  config.vm.provider "virtualbox" do |v|
    v.memory = 1024
    v.cpus = 1
  end

  config.winrm.max_tries = 300 # default is 20
  config.winrm.retry_delay = 2 #seconds. This is the defaul value and just here for documentation.
  
  config.vm.provision "file", source: "~/", destination: "git"
end