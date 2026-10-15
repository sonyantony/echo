package com.ey.echo.builder.flow;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;

/** One file of a flow draft: the Camel YAML, DataMapper XSLT, a JSON schema, Kaoto metadata, etc. */
@Entity
public class FlowFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "flow_id")
    private Flow flow;

    @Column(nullable = false)
    private String path;

    @Lob
    @Column(nullable = false)
    private String content;

    protected FlowFile() {}

    FlowFile(Flow flow, String path, String content) {
        this.flow = flow;
        this.path = path;
        this.content = content;
    }

    public String getPath() {
        return path;
    }

    void setPath(String path) {
        this.path = path;
    }

    public String getContent() {
        return content;
    }

    void setContent(String content) {
        this.content = content;
    }
}
