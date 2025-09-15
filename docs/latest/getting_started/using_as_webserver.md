## Using as a webserver (without scripting)
You can use Akeno without scripting or code, similarly to how you define Nginx server blocks and host static files.<br>
Simply make a folder for your website in a location defined in the config.<br>
Akeno will create an `Units.WebApp` instance for you, which will automatically handle things like caching, compression, routing, and more.

The basic file structure:
```pd:file_structure
my_site/
├─ app.conf
└─ index.html
```
This is enough for a simple website.

In app.conf, you place configuration for the site.
To get a website running, you only need to define the domains (or simply `*` to catch all):
```nginx
server {
    domains: localhost, example.{com, net}, ...;
}
```
Then after running `akeno reload`, your index.html should be live on http://localhost/.<br>
As simple as that! There is a lot more that can be placed in app.conf - see [app configuration files](/app-config).
